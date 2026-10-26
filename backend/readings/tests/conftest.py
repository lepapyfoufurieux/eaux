from io import BytesIO

import pytest
from django.contrib.gis.geos import MultiPolygon, Point, Polygon
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from geo.models import Basin
from readings.models import Station

# A rough box around the Saurat valley, enough for tests.
BASIN_BOX = Polygon.from_bbox((1.45, 42.84, 1.61, 42.92))


@pytest.fixture(autouse=True)
def media_root(tmp_path, settings):
    settings.MEDIA_ROOT = tmp_path


@pytest.fixture
def basin(db):
    return Basin.objects.create(outline=MultiPolygon(BASIN_BOX, srid=4326))


@pytest.fixture
def stations(db):
    return {
        "loumet": Station.objects.create(code="S02", name="Pont de Loumet", location=Point(1.4890, 42.8790, srid=4326)),
        "village": Station.objects.create(code="S04", name="Pont du village", location=Point(1.5260, 42.8700, srid=4326)),
    }


@pytest.fixture(autouse=True)
def fresh_cache():
    # The upload limit lives in a file cache that outlives a test run; start each test from zero.
    cache.clear()


@pytest.fixture
def photo_file():
    def make(name="photo.jpg"):
        buffer = BytesIO()
        exif = Image.Exif()
        exif[0x010F] = "PhoneMaker"  # Make
        Image.new("RGB", (3000, 2000), (40, 120, 160)).save(buffer, "JPEG", exif=exif)
        return SimpleUploadedFile(name, buffer.getvalue(), content_type="image/jpeg")

    return make
