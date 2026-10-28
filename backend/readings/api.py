from datetime import date, datetime, timedelta
from uuid import UUID

from django.conf import settings
from django.contrib.gis.geos import Point
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import File, Form, Router, Schema, Status
from ninja.errors import HttpError
from ninja.files import UploadedFile
from ninja.security import django_auth
from ninja.throttling import UserRateThrottle
from pydantic import AwareDatetime

from geo.models import Basin

from .attachment import nearest_station
from .export import csv_response, published_readings
from .images import process_photo
from .models import FlowLevel, Reading, Station

router = Router(tags=["readings"])
MAX_COMMENT_CHARS = 2000


class StationOut(Schema):
    code: str
    name: str
    watercourse: str | None
    watercourse_id: int | None
    order: int
    lat: float
    lng: float

    @staticmethod
    def resolve_watercourse(obj):
        return obj.watercourse.name if obj.watercourse else None

    @staticmethod
    def resolve_lat(obj):
        return obj.location.y

    @staticmethod
    def resolve_lng(obj):
        return obj.location.x


class ReadingOut(Schema):
    id: UUID
    taken_at: datetime
    flow_level: str
    comment: str
    author_name: str
    station: str | None
    lat: float
    lng: float
    photo: str
    thumbnail: str

    @staticmethod
    def resolve_station(obj):
        return obj.station.code if obj.station else None

    @staticmethod
    def resolve_lat(obj):
        return obj.location.y

    @staticmethod
    def resolve_lng(obj):
        return obj.location.x

    @staticmethod
    def resolve_photo(obj):
        return obj.photo.url

    @staticmethod
    def resolve_thumbnail(obj):
        return obj.thumbnail.url


class MyReadingOut(ReadingOut):
    # The contributor also sees the readings an admin hid.
    status: str


class ReadingIn(Schema):
    # Missing when the photo lost its position (messaging apps); a station is then required.
    lat: float | None = None
    lng: float | None = None
    taken_at: AwareDatetime
    flow_level: FlowLevel
    comment: str = ""
    # Required without a position. With one it is ignored: a GPS photo always joins its nearest station.
    station: str | None = None


class PublishedOut(Schema):
    reading: ReadingOut
    station_distance_m: float | None


@router.get("/stations", response=list[StationOut])
def list_stations(request):
    return Station.objects.filter(active=True).select_related("watercourse")


@router.get("/readings", response=list[ReadingOut])
def list_readings(request):
    """Every published reading, without the images. The map and the river plan both work from this list."""
    return Reading.objects.filter(status=Reading.Status.PUBLISHED).select_related("station")


@router.get("/me/readings", auth=django_auth, response=list[MyReadingOut])
def my_readings(request):
    """The "Mon compte" page: every reading of the signed-in account, hidden ones included."""
    return Reading.objects.filter(owner=request.user).select_related("station")


@router.delete("/me/readings/{reading_id}", auth=django_auth, response={204: None})
def delete_my_reading(request, reading_id: UUID):
    """A contributor deletes one of their readings; editing is left to the admins. The signal removes the photo files."""
    get_object_or_404(Reading, id=reading_id, owner=request.user).delete()
    return Status(204, None)


@router.get("/readings.csv")
def export_readings(request, date_from: date | None = None, date_to: date | None = None):
    return csv_response(published_readings(date_from, date_to))


@router.post(
    "/readings",
    response={201: PublishedOut},
    # Only signed-in accounts publish; a suspended account counts as signed out.
    auth=django_auth,
    throttle=[UserRateThrottle("30/h")],
)
def publish_reading(request, data: Form[ReadingIn], photo: File[UploadedFile]):
    if data.lat is None or data.lng is None:
        if not data.station:
            raise HttpError(422, "Sans position dans la photo, choisissez le cours d'eau et la station.")
        point = None
    else:
        point = Point(data.lng, data.lat, srid=4326)
        if not Basin.contains(point):
            raise HttpError(422, "Cette photo a été prise hors du bassin versant de Saurat.")
    if photo.size > settings.MAX_PHOTO_BYTES:
        raise HttpError(413, "La photo est trop lourde.")
    author = request.user.first_name.strip()
    if not author:
        raise HttpError(422, "Indiquez votre nom ou prénom.")
    # A wrong camera clock would stretch both views to an empty future month for everyone.
    if data.taken_at > timezone.now() + timedelta(days=1):
        raise HttpError(422, "La date de la photo est dans le futur : vérifiez l'horloge de l'appareil.")
    # Every visitor downloads every comment.
    if len(data.comment) > MAX_COMMENT_CHARS:
        raise HttpError(422, f"Le commentaire dépasse {MAX_COMMENT_CHARS} caractères.")

    if point is None:
        station = get_object_or_404(Station, code=data.station, active=True)
        # No position: the photo stands at its station; no distance tells moderators it was placed by hand.
        point, distance = station.location, None
    else:
        station, distance = nearest_station(point)

    reading = Reading(
        location=point,
        taken_at=data.taken_at,
        flow_level=data.flow_level,
        comment=data.comment.strip(),
        author_name=author[:60],
        owner=request.user,
        station=station,
        station_distance_m=distance,
    )
    try:
        full, thumb = process_photo(photo, str(reading.id))
    except ValueError:
        raise HttpError(422, "Ce format d'image n'est pas pris en charge.")
    with transaction.atomic():
        reading.photo.save(full.name, full, save=False)
        reading.thumbnail.save(thumb.name, thumb, save=False)
        reading.save()
    return Status(201, {"reading": reading, "station_distance_m": distance})
