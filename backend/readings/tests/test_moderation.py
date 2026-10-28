from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from django.contrib.admin.models import CHANGE, DELETION, LogEntry
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core import mail

from readings.models import Reading

pytestmark = pytest.mark.django_db
CHANGELIST = "/admin/readings/reading/"


def reading(owner):
    return Reading.objects.create(
        location=Point(1.489, 42.879, srid=4326),
        taken_at=datetime(2026, 10, 12, 15, 45, tzinfo=ZoneInfo("Europe/Paris")),
        flow_level="normal",
        author_name=owner.first_name if owner else "Ancien",
        owner=owner,
        photo="photos/a.jpg",
        thumbnail="thumbs/a.jpg",
    )


@pytest.fixture
def admin_client(client):
    client.force_login(get_user_model().objects.create_superuser(username="admin", email="admin@example.org", password="x"))
    return client


def test_hiding_asks_a_reason_then_mails_it_to_each_contributor(admin_client, contributor):
    first, second, older = reading(contributor), reading(contributor), reading(None)
    selected = {"action": "hide", "_selected_action": [first.pk, second.pk, older.pk]}

    page = admin_client.post(CHANGELIST, selected)
    assert page.status_code == 200 and "Pourquoi masquer ces relevés ?" in page.text
    assert Reading.objects.filter(status=Reading.Status.HIDDEN).count() == 0

    admin_client.post(CHANGELIST, {**selected, "apply": "1", "reason": "blurry", "message": "Reprenez-la de jour."})
    assert Reading.objects.filter(status=Reading.Status.HIDDEN).count() == 3
    [notice] = mail.outbox
    assert notice.to == ["marion@example.org"]
    assert "masqué vos 2 photos" in notice.body
    assert "Photo floue ou trop sombre" in notice.body and "Reprenez-la de jour." in notice.body
    logged = LogEntry.objects.filter(action_flag=CHANGE)
    assert sorted(logged.values_list("object_id", flat=True)) == sorted(str(r.pk) for r in (first, second, older))
    assert logged.first().get_change_message() == "Masqué. Motif : Photo floue ou trop sombre (Reprenez-la de jour.)"
    assert "Reprenez-la de jour." in admin_client.get("/admin/accounts/moderationlog/").text


def test_other_reason_needs_a_message(admin_client, contributor):
    mine = reading(contributor)
    selected = {"action": "delete_with_reason", "_selected_action": [mine.pk], "apply": "1", "reason": "other"}

    assert "Précisez la raison." in admin_client.post(CHANGELIST, selected).text
    assert Reading.objects.exists() and not mail.outbox

    admin_client.post(CHANGELIST, {**selected, "message": "Photo d'un autre ruisseau."})
    assert not Reading.objects.exists()
    assert "supprimé votre photo" in mail.outbox[0].body and "Photo d'un autre ruisseau." in mail.outbox[0].body
    assert LogEntry.objects.get(action_flag=DELETION).get_change_message() == "Supprimé. Motif : Photo d'un autre ruisseau."


def test_the_bulk_delete_without_reason_is_gone(admin_client, contributor):
    reading(contributor)
    assert "delete_selected" not in admin_client.get(CHANGELIST).text
