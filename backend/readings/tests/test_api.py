import csv
import io
from pathlib import Path

import pytest
from django.contrib import admin
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from readings.models import Reading

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def signed_in(client, contributor):
    client.force_login(contributor)


def publish(client, photo, **fields):
    data = {
        "lat": 42.8791,
        "lng": 1.4893,
        "taken_at": "2026-10-12T15:45:00+02:00",
        "flow_level": "normal",
        "comment": "Retour à la normale.",
        "photo": photo,
    }
    data.update(fields)
    return client.post("/api/readings", data)


def export(client):
    exported = b"".join(client.get("/api/readings.csv").streaming_content).decode()
    return list(csv.reader(io.StringIO(exported)))


def test_publish_attaches_station_and_strips_metadata(client, basin, stations, photo_file, contributor):
    response = publish(client, photo_file())
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["reading"]["station"] == "S02"
    assert body["station_distance_m"] < 50

    reading = Reading.objects.get()
    assert (reading.owner, reading.author_name) == (contributor, "Marion")
    with Image.open(reading.photo.path) as image:
        assert max(image.size) == 1600
        assert not image.getexif()


def test_gps_photo_joins_its_nearest_station_whatever_is_sent(client, basin, stations, photo_file):
    response = publish(client, photo_file(), station="S04")
    assert response.json()["reading"]["station"] == "S02"
    assert response.json()["station_distance_m"] < 50


def without_position(photo, **fields):
    return {"taken_at": "2026-10-12T15:45:00+02:00", "flow_level": "normal", "photo": photo, **fields}


def test_photo_without_position_goes_to_the_chosen_station(client, basin, stations, photo_file):
    response = client.post("/api/readings", without_position(photo_file(), station="S04"))
    assert response.status_code == 201, response.content
    body = response.json()
    assert body["reading"]["station"] == "S04"
    assert (body["reading"]["lat"], body["reading"]["lng"]) == (42.87, 1.526)
    assert body["station_distance_m"] is None


def test_photo_without_position_needs_a_station(client, basin, stations, photo_file):
    response = client.post("/api/readings", without_position(photo_file()))
    assert response.status_code == 422
    assert Reading.objects.count() == 0


def test_only_active_accounts_publish(client, basin, stations, photo_file, contributor):
    client.logout()
    assert publish(client, photo_file()).status_code == 401

    client.force_login(contributor)
    contributor.is_active = False
    contributor.save()
    assert publish(client, photo_file()).status_code == 401
    assert Reading.objects.count() == 0


def test_account_without_a_name_cannot_publish(client, basin, stations, photo_file, contributor):
    contributor.first_name = ""
    contributor.save()
    assert publish(client, photo_file()).status_code == 422


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

    rows = export(client)
    assert rows[0] == ["date", "debit", "commentaire", "lat", "long", "station", "auteur"]
    assert len(rows) == 2 and rows[1][1] == "normal"


def test_csv_export_keeps_formulas_inert(client, basin, stations, photo_file, contributor):
    contributor.first_name = '=HYPERLINK("http://evil.example")'
    contributor.save()
    publish(client, photo_file(), comment="+33 6 00")
    row = export(client)[1]
    assert row[6] == '\'=HYPERLINK("http://evil.example")'
    assert row[2] == "'+33 6 00"


def huge_png():
    # 48 million pixels in a few kilobytes.
    buffer = io.BytesIO()
    Image.new("1", (8000, 6000)).save(buffer, "PNG")
    return SimpleUploadedFile("huge.png", buffer.getvalue(), content_type="image/png")


@pytest.mark.parametrize(
    "fields",
    [
        lambda: {"taken_at": "2099-01-01T10:00:00+01:00"},
        lambda: {"taken_at": "2026-10-12T15:45:00"},  # no time zone
        lambda: {"comment": "x" * 2001},
        lambda: {"photo": huge_png()},
    ],
    ids=["future-date", "naive-date", "long-comment", "huge-image"],
)
def test_bad_publish_is_refused(client, basin, stations, photo_file, fields):
    response = publish(client, **{"photo": photo_file(), **fields()})
    assert response.status_code == 422, response.content
    assert Reading.objects.count() == 0


def test_deleting_a_reading_removes_its_files(client, basin, stations, photo_file):
    publish(client, photo_file())
    reading = Reading.objects.get()
    paths = [Path(reading.photo.path), Path(reading.thumbnail.path)]
    assert all(p.exists() for p in paths)

    Reading.objects.all().delete()  # what the admin's bulk delete does
    assert not any(p.exists() for p in paths)


def test_signed_in_visitors_report_a_photo_once(client, basin, stations, photo_file, contributor, rf):
    reading_id = publish(client, photo_file()).json()["reading"]["id"]
    url = f"/api/readings/{reading_id}/report"
    assert client.post(url).status_code == 204
    assert client.post(url).status_code == 204
    reading = Reading.objects.get()
    assert list(reading.reports.values_list("reporter", flat=True)) == [contributor.pk]

    reading_admin = admin.site._registry[Reading]
    listed = reading_admin.get_queryset(rf.get("/"))
    assert listed.get().report_count == 1
    reading_admin.hide(rf.post("/"), listed)
    reading.refresh_from_db()
    assert reading.status == Reading.Status.HIDDEN
    assert client.post(url).status_code == 404

    client.logout()
    assert client.post(url).status_code == 401
