"""Load the prepared IGN / OFB layers from GeoJSON files (see data/README.md).

    python manage.py import_geodata --basin data/basin.geojson \
        --watercourses data/watercourses.geojson --springs data/springs.geojson
"""

import json

from django.contrib.gis.geos import GEOSGeometry, MultiLineString, MultiPolygon
from django.core.management.base import BaseCommand
from django.db import transaction

from geo.models import Basin, Spring, Watercourse


def read_features(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["features"]


def geometry(feature):
    return GEOSGeometry(json.dumps(feature["geometry"]), srid=4326)


class Command(BaseCommand):
    help = "Import the basin outline, watercourses and springs from GeoJSON files (EPSG:4326)."

    def add_arguments(self, parser):
        parser.add_argument("--basin")
        parser.add_argument("--watercourses")
        parser.add_argument("--springs")

    @transaction.atomic
    def handle(self, *args, basin=None, watercourses=None, springs=None, **options):
        if basin:
            Basin.objects.all().delete()
            for f in read_features(basin):
                geom = geometry(f)
                if geom.geom_type == "Polygon":
                    geom = MultiPolygon(geom, srid=4326)
                Basin.objects.create(outline=geom, name=f["properties"].get("name", "Bassin versant du Saurat"))
            self.stdout.write(f"Basin: {Basin.objects.count()} outline(s)")

        if watercourses:
            imported = []
            for f in read_features(watercourses):
                geom = geometry(f)
                if geom.geom_type == "LineString":
                    geom = MultiLineString(geom, srid=4326)
                code, name = f["properties"].get("code", ""), f["properties"]["name"]
                # Match by code, else by name, so watercourses created by hand (with their stations) get their line.
                w = (
                    (code and Watercourse.objects.filter(topage_code=code).first())
                    or Watercourse.objects.filter(topage_code="", name__iexact=name).exclude(id__in=imported).first()
                    or Watercourse(name=name)
                )
                w.topage_code, w.geometry = code, geom
                w.save()
                imported.append(w.id)
            self.stdout.write(f"Watercourses: {Watercourse.objects.count()}")

        if springs:
            Spring.objects.all().delete()
            Spring.objects.bulk_create(
                Spring(
                    location=geometry(f),
                    kind=f["properties"].get("kind", "Source"),
                    altitude_m=f["properties"].get("altitude_m"),
                    origin=f["properties"].get("origin", "ign").lower(),
                )
                for f in read_features(springs)
            )
            self.stdout.write(f"Springs: {Spring.objects.count()}")
