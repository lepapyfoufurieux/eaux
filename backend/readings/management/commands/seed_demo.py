"""Fill an empty database with the mockup's fictitious data, for development only.

    python manage.py seed_demo
"""

from datetime import datetime
from io import BytesIO
from zoneinfo import ZoneInfo

from django.contrib.gis.geos import MultiPolygon, Point, Polygon
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from PIL import Image, ImageDraw

from geo.models import Basin, Watercourse
from readings.models import Reading, Station

PARIS = ZoneInfo("Europe/Paris")

# Rough outline from the mockup, as (lat, lng).
BASIN = [(42.889, 1.451), (42.900, 1.462), (42.910, 1.478), (42.914, 1.497), (42.912, 1.516), (42.913, 1.536),
         (42.906, 1.556), (42.902, 1.572), (42.892, 1.586), (42.877, 1.594), (42.862, 1.601), (42.853, 1.588),
         (42.849, 1.566), (42.848, 1.545), (42.851, 1.522), (42.855, 1.500), (42.859, 1.480), (42.866, 1.462),
         (42.878, 1.452)]

# watercourse: (confluence position along Le Saurat, [(code, name, lat, lng, readings)])
DEMO = {
    "Le Saurat": (None, [
        ("S01", "Sous le col", 42.8845, 1.4705, [("Claire", "2025-08-23 10:30", "dry"), ("Claire", "2026-03-18 11:00", "normal"), ("Claire", "2026-08-23 10:30", "dry")]),
        ("S02", "Pont de Loumet", 42.8790, 1.4890, [("Bastien", "2026-05-11 08:40", "high"), ("Bastien", "2026-08-30 19:05", "very_low")]),
        ("S03", "Ancien moulin", 42.8728, 1.5085, [("Marion", "2026-02-07 14:30", "high"), ("Marion", "2026-10-12 15:45", "normal")]),
        ("S04", "Pont du village", 42.8700, 1.5260, [("Sophie", "2025-12-12 10:00", "high"), ("Sophie", "2026-07-30 18:00", "very_low"), ("Odile", "2026-10-08 09:45", "normal")]),
        ("S05", "Prat du bas", 42.8678, 1.5455, [("Bastien", "2026-06-03 12:00", "normal"), ("Bastien", "2026-09-05 12:10", "very_low")]),
        ("S06", "Sortie du bassin", 42.8640, 1.5770, [("Sophie", "2025-11-05 11:40", "high"), ("Sophie", "2026-09-10 11:10", "very_low")]),
    ]),
    "Ruisseau de la Pelade": (0.1, [("S07", "Sous la Pelade", 42.8955, 1.4975, [("Jean-Pierre", "2026-07-15 11:20", "very_low")])]),
    "Ruisseau de la Ruzole": (0.25, [("S08", "Gué de La Ruzole", 42.8762, 1.4990, [("Odile", "2026-06-28 07:50", "normal"), ("Odile", "2026-09-21 08:10", "very_low")])]),
    "Ruisseau de la Castelle": (0.45, [
        ("S09", "Haut de La Castelle", 42.8560, 1.5255, [("Marion", "2026-08-12 17:40", "dry")]),
        ("S10", "Lavoir de La Castelle", 42.8620, 1.5265, [("Marion", "2026-08-12 17:15", "dry")]),
    ]),
    "Ruisseau de la Combe": (0.6, [
        ("S11", "Haut de la combe", 42.8945, 1.5385, [("Jean-Pierre", "2026-10-15 13:20", "normal")]),
        ("S12", "Combe du nord", 42.8820, 1.5360, [("Claire", "2026-05-24 10:00", "normal"), ("Claire", "2026-08-02 10:00", "very_low")]),
    ]),
    "Ruisseau de Loubatière": (0.8, [("S13", "Cascade de Loubatière", 42.8815, 1.5620, [("Odile", "2026-03-02 15:30", "high"), ("Odile", "2026-07-21 15:00", "normal")])]),
}

COLOURS = {"dry": (186, 150, 110), "very_low": (140, 150, 120), "normal": (70, 120, 150), "high": (110, 90, 70)}


def fake_photo(flow, name):
    image = Image.new("RGB", (1200, 900), COLOURS[flow])
    ImageDraw.Draw(image).rectangle((0, 600, 1200, 900), fill=(60, 90, 60))
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=70)
    return ContentFile(buffer.getvalue(), name=f"{name}.jpg")


class Command(BaseCommand):
    help = "Load the mockup's fictitious stations and readings (development only)."

    def handle(self, *args, **options):
        if Reading.objects.exists() or Station.objects.exists():
            raise CommandError("The database already holds data; seed_demo only fills an empty one.")

        ring = [(lng, lat) for lat, lng in BASIN] + [(BASIN[0][1], BASIN[0][0])]
        Basin.objects.create(outline=MultiPolygon(Polygon(ring), srid=4326))

        trunk = None
        for river, (confluence, stations) in DEMO.items():
            watercourse = Watercourse.objects.create(name=river, tributary_of=trunk, confluence_position=confluence)
            trunk = trunk or watercourse
            for order, (code, name, lat, lng, readings) in enumerate(stations, start=1):
                station = Station.objects.create(
                    code=code, name=name, watercourse=watercourse, order=order, location=Point(lng, lat, srid=4326)
                )
                for i, (author, when, flow) in enumerate(readings):
                    reading = Reading(
                        location=Point(lng + 0.00005 * i, lat, srid=4326),
                        taken_at=datetime.fromisoformat(when).replace(tzinfo=PARIS),
                        flow_level=flow,
                        author_name=author,
                        station=station,
                        station_distance_m=4.0 * i,
                    )
                    reading.issue_edit_key()
                    reading.photo.save(f"{code}-{i}", fake_photo(flow, f"{code}-{i}"), save=False)
                    reading.thumbnail.save(f"{code}-{i}", fake_photo(flow, f"{code}-{i}"), save=False)
                    reading.save()

        self.stdout.write(self.style.SUCCESS(f"{Station.objects.count()} stations, {Reading.objects.count()} readings"))
