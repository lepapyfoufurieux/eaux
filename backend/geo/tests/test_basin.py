from pathlib import Path

import pytest
from django.contrib.gis.geos import Point
from django.core.management import call_command

from geo.models import Basin

BASIN_FILE = Path(__file__).resolve().parents[3] / "data" / "basin.geojson"


@pytest.mark.django_db
def test_prepared_outline_keeps_the_valley_and_refuses_its_neighbours():
    call_command("import_geodata", basin=str(BASIN_FILE))

    assert Basin.contains(Point(1.5317, 42.8737, srid=4326))  # Saurat village
    assert Basin.contains(Point(1.60224088, 42.86023336, srid=4326))  # the Saurat at its confluence
    assert not Basin.contains(Point(1.6036, 42.8456, srid=4326))  # Tarascon-sur-Ariège
    assert not Basin.contains(Point(1.5590, 42.8530, srid=4326))  # Rabat, Courbière valley
