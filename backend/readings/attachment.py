"""Attach a reading to the nearest active station."""

from django.conf import settings
from django.contrib.gis.db.models.functions import Distance
from django.contrib.gis.measure import D

from .models import Station


def nearest_station(point, radius_m=None):
    """Return (station, distance in metres) for the nearest active station within the radius, or (None, None).

    Near a confluence the nearest station can sit on the other watercourse, so the
    publish form lets the contributor pick another one and admins can correct it.
    """
    radius_m = settings.STATION_ATTACH_RADIUS_M if radius_m is None else radius_m
    station = (
        Station.objects.filter(active=True, location__dwithin=(point, D(m=radius_m)))
        .annotate(distance=Distance("location", point))
        .order_by("distance")
        .first()
    )
    if station is None:
        return None, None
    return station, station.distance.m
