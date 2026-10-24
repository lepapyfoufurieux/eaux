import csv
import io

import pytest
from PIL import Image

from readings.models import Reading

pytestmark = pytest.mark.django_db


def publish(client, photo, **fields):
    data = {
        "lat": 42.8791,
        "lng": 1.4893,
        "taken_at": "2026-10-12T15:45:00+02:00",
        "flow_level": "normal",
        "author_name": "Marion",
        "comment": "Retour à la normale.",
        "photo": photo,
    }
    data.update(fields)
    return client.post("/api/readings", data)


def test_publish_attaches_station_and_strips_metadata(client, basin, stations, photo_file):
    response = publish(client, photo_file())
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["reading"]["station"] == "S02"
    assert body["station_distance_m"] < 50
    assert len(body["edit_key"]) > 20

    reading = Reading.objects.get()
    assert reading.check_edit_key(body["edit_key"])
    with Image.open(reading.photo.path) as image:
        assert max(image.size) == 1600
        assert not image.getexif()


def test_contributor_can_pick_another_station(client, basin, stations, photo_file):
    response = publish(client, photo_file(), station="S04")
    assert response.json()["reading"]["station"] == "S04"
    assert response.json()["station_distance_m"] > 2000


def test_photo_outside_basin_is_refused(client, basin, stations, photo_file):
    response = publish(client, photo_file(), lat=43.0, lng=1.6)
    assert response.status_code == 422
    assert Reading.objects.count() == 0


def test_hidden_readings_are_not_listed_or_exported(client, basin, stations, photo_file):
    publish(client, photo_file())
    publish(client, photo_file(), flow_level="dry")
    Reading.objects.filter(flow_level="dry").update(status=Reading.Status.HIDDEN)

    listed = client.get("/api/readings").json()
    assert [r["flow_level"] for r in listed] == ["normal"]

    exported = b"".join(client.get("/api/readings.csv").streaming_content).decode()
    rows = list(csv.reader(io.StringIO(exported)))
    assert rows[0] == ["date", "debit", "commentaire", "lat", "long", "station", "auteur"]
    assert len(rows) == 2 and rows[1][1] == "normal"
