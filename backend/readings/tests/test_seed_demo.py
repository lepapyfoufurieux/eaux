import json

import pytest
from django.conf import settings
from django.contrib.gis.geos import GEOSGeometry
from django.core.management import call_command

from geo.models import Basin, Spring, Watercourse
from readings.models import Reading, Station


@pytest.mark.django_db
def test_demo_stations_sit_on_their_watercourse_inside_the_basin():
    call_command("seed_demo")

    features = json.loads((settings.BASE_DIR.parent / "data" / "watercourses.geojson").read_text("utf-8"))["features"]
    assert Watercourse.objects.count() == len(features)  # unnamed brooks do not overwrite each other
    outline = Basin.objects.get().outline
    for station in Station.objects.select_related("watercourse"):
        point = GEOSGeometry(station.location.wkt, srid=4326)
        assert station.watercourse.geometry.distance(point) < 1e-6, station.code
        assert outline.contains(point), station.code
    for w in {s.watercourse for s in Station.objects.all()}:
        assert w.tributary_of is None or 0 <= w.confluence_position <= 1, w.name

    # A few photos are taken at real springs.
    springs = [s.location for s in Spring.objects.all()]
    at_springs = [r for r in Reading.objects.all() if any(GEOSGeometry(r.location.wkt, srid=4326).equals(s) for s in springs)]
    assert len(at_springs) == 4
