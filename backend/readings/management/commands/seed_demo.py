"""Fill an empty database with fictitious readings on the real watercourses, for development only.

    python manage.py seed_demo

Imports the real basin, watercourses and springs from data/ (see data/README.md), then places
the demo stations along those lines and a few photos at named springs.
"""

from datetime import datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.gis.geos import LineString, Point
from django.core.files.base import ContentFile
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from PIL import Image, ImageDraw

from geo.models import Spring, Watercourse
from readings.attachment import nearest_station
from readings.models import Reading, Station

PARIS = ZoneInfo("Europe/Paris")
DATA = settings.BASE_DIR.parent / "data"
TRUNK = "O1220500"  # Le Saurat
OUTLET = Point(1.60197, 42.86017, srid=4326)  # its confluence with the Ariège

# BD TOPAGE code: [(station code, name, position along the watercourse from its source (0) to its mouth (1), readings)]
DEMO = {
    TRUNK: [
        ("S01", "Sous le col", 0.12, [("Claire", "2025-08-23 10:30", "dry"), ("Claire", "2026-03-18 11:00", "normal"), ("Claire", "2026-08-23 10:30", "dry")]),
        ("S02", "Pont de Loumet", 0.3, [("Bastien", "2026-05-11 08:40", "high"), ("Bastien", "2026-08-30 19:05", "very_low")]),
        ("S03", "Ancien moulin", 0.45, [("Marion", "2026-02-07 14:30", "high"), ("Marion", "2026-10-12 15:45", "normal")]),
        ("S04", "Pont du village", 0.6, [("Sophie", "2025-12-12 10:00", "high"), ("Sophie", "2026-07-30 18:00", "very_low"), ("Odile", "2026-10-08 09:45", "normal")]),
        ("S05", "Prat du bas", 0.78, [("Bastien", "2026-06-03 12:00", "normal"), ("Bastien", "2026-09-05 12:10", "very_low")]),
        ("S06", "Sortie du bassin", 0.95, [("Sophie", "2025-11-05 11:40", "high"), ("Sophie", "2026-09-10 11:10", "very_low")]),
    ],
    "O1220570": [  # Ruisseau de Loumet
        ("S07", "Haut du Loumet", 0.3, [("Jean-Pierre", "2026-07-15 11:20", "very_low")]),
        ("S08", "Bas du Loumet", 0.85, [("Odile", "2026-06-28 07:50", "normal"), ("Odile", "2026-09-21 08:10", "very_low")]),
    ],
    "O1220600": [  # Ruisseau de la Ruzole
        ("S09", "Gué de la Ruzole", 0.6, [("Marion", "2026-08-12 17:40", "dry")]),
    ],
    "O1220650": [  # Ruisseau de l'Arse
        ("S10", "Haut de l'Arse", 0.35, [("Marion", "2026-08-12 17:15", "dry")]),
        ("S11", "Confluent de l'Arse", 0.9, [("Jean-Pierre", "2026-10-15 13:20", "normal")]),
    ],
    "O1220510": [  # Ruisseau du Bazercal
        ("S12", "Sous le Bazercal", 0.7, [("Claire", "2026-05-24 10:00", "normal"), ("Claire", "2026-08-02 10:00", "very_low")]),
    ],
    "O1220620": [  # Ruisseau de Bernaux et de Mellès
        ("S13", "Bas de Bernaux", 0.75, [("Odile", "2026-03-02 15:30", "high"), ("Odile", "2026-07-21 15:00", "normal")]),
    ],
}

# Photos taken at named springs (BD TOPO), attached to a station only if one is within reach.
SPRINGS = [
    ("Fontaine de Belcaude", [("Jean-Pierre", "2026-06-14 09:30", "normal"), ("Jean-Pierre", "2026-09-27 10:15", "very_low")]),
    ("Font Soule", [("Sophie", "2026-08-18 16:20", "dry")]),
    ("Fontaine d'Estibat", [("Claire", "2026-10-03 11:00", "normal")]),
]

COLOURS = {"dry": (186, 150, 110), "very_low": (140, 150, 120), "normal": (70, 120, 150), "high": (110, 90, 70)}


def fake_photo(flow, name):
    image = Image.new("RGB", (1200, 900), COLOURS[flow])
    ImageDraw.Draw(image).rectangle((0, 600, 1200, 900), fill=(60, 90, 60))
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=70)
    return ContentFile(buffer.getvalue(), name=f"{name}.jpg")


def course(geometry, mouth):
    """One line from source to mouth: the pieces of the watercourse, each pointing at the mouth, farthest first."""
    merged = geometry.merged
    pieces = [list(p.coords) for p in (merged if merged.geom_type == "MultiLineString" else [merged])]
    pieces = [p if Point(p[-1]).distance(mouth) <= Point(p[0]).distance(mouth) else p[::-1] for p in pieces]
    pieces.sort(key=lambda p: -Point(p[0]).distance(mouth))
    return LineString([xy for p in pieces for xy in p], srid=4326)


class Command(BaseCommand):
    help = "Load fictitious stations and readings on the real watercourses (development only)."

    def handle(self, *args, **options):
        if Reading.objects.exists() or Station.objects.exists():
            raise CommandError("The database already holds data; seed_demo only fills an empty one.")
        call_command(
            "import_geodata",
            basin=str(DATA / "basin.geojson"),
            watercourses=str(DATA / "watercourses.geojson"),
            springs=str(DATA / "springs.geojson"),
            stdout=self.stdout,
        )

        trunk = Watercourse.objects.get(topage_code=TRUNK)
        trunk_line = course(trunk.geometry, OUTLET)
        for topage_code, stations in DEMO.items():
            watercourse = Watercourse.objects.get(topage_code=topage_code)
            if watercourse == trunk:
                line = trunk_line
            else:
                # A tributary's mouth is its end on the Saurat; the river plan needs where that is along the Saurat.
                line = course(watercourse.geometry, trunk.geometry)
                watercourse.tributary_of = trunk
                watercourse.confluence_position = round(trunk_line.project_normalized(Point(line.coords[-1])), 2)
                watercourse.save()
            for order, (code, name, position, readings) in enumerate(stations, start=1):
                point = line.interpolate_normalized(position)
                point.srid = 4326
                station = Station.objects.create(code=code, name=name, watercourse=watercourse, order=order, location=point)
                for i, (author, when, flow) in enumerate(readings):
                    self.reading(Point(point.x + 0.00005 * i, point.y, srid=4326), author, when, flow, f"{code}-{i}", station, 4.0 * i)

        for name, readings in SPRINGS:
            spring = Spring.objects.get(kind__contains=f"({name})")
            station, distance = nearest_station(spring.location)
            for i, (author, when, flow) in enumerate(readings):
                self.reading(spring.location, author, when, flow, f"source-{spring.pk}-{i}", station, distance)

        self.stdout.write(self.style.SUCCESS(f"{Station.objects.count()} stations, {Reading.objects.count()} readings"))

    def reading(self, location, author, when, flow, name, station, distance):
        reading = Reading(
            location=location,
            taken_at=datetime.fromisoformat(when).replace(tzinfo=PARIS),
            flow_level=flow,
            author_name=author,
            station=station,
            station_distance_m=distance,
        )
        reading.photo.save(name, fake_photo(flow, name), save=False)
        reading.thumbnail.save(name, fake_photo(flow, name), save=False)
        reading.save()
