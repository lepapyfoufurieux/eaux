import io
import re
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.gis.geos import Point
from django.core import mail
from django.core.management import call_command

from readings.models import Reading

pytestmark = pytest.mark.django_db
User = get_user_model()


def ask_link(client, email="marion@example.org"):
    return client.post("/api/auth/link", {"email": email}, content_type="application/json")


def mailed_link():
    return re.search(r"http://testserver(/api/auth/login\?token=\S+)", mail.outbox[-1].body).group(1)


def reading(owner, **fields):
    return Reading.objects.create(
        location=Point(1.489, 42.879, srid=4326),
        taken_at=datetime(2026, 10, 12, 15, 45, tzinfo=ZoneInfo("Europe/Paris")),
        flow_level="normal",
        author_name=owner.first_name if owner else "Ancien",
        owner=owner,
        **fields,
    )


def test_first_link_creates_the_account_and_signs_in(client):
    assert ask_link(client, " Marion@Example.org ").status_code == 204
    assert mail.outbox[-1].to == ["marion@example.org"]

    response = client.get(mailed_link())
    assert response.status_code == 302 and response.url == "/?connexion=ok"
    user = User.objects.get()
    assert (user.email, user.first_name, user.has_usable_password()) == ("marion@example.org", "", False)
    assert client.get("/api/me").json() == {"name": ""}


def test_link_signs_in_an_existing_account_once(client, contributor):
    ask_link(client)
    link = mailed_link()
    assert client.get(link).url == "/?connexion=ok"
    assert User.objects.count() == 1

    client.logout()
    assert client.get(link).url == "/?connexion=invalide"
    assert client.get("/api/me").status_code == 401


def test_expired_or_forged_link_is_refused(client, contributor, settings):
    ask_link(client)
    settings.LOGIN_LINK_MAX_AGE = -1
    assert client.get(mailed_link()).url == "/?connexion=invalide"
    assert client.get("/api/auth/login?token=forged").url == "/?connexion=invalide"
    assert client.get("/api/me").status_code == 401


def test_suspended_account_cannot_sign_in(client, contributor):
    contributor.is_active = False
    contributor.save()
    ask_link(client)
    assert client.get(mailed_link()).url == "/?connexion=suspendu"
    assert client.get("/api/me").status_code == 401


def test_link_requests_are_limited_per_address(client):
    for _ in range(6):
        assert ask_link(client).status_code in (204, 429)
    assert len(mail.outbox) == 5


def test_bad_address_is_refused(client):
    assert ask_link(client, "pas-une-adresse").status_code == 422
    assert not mail.outbox


def test_renaming_renames_the_published_readings(client, contributor):
    mine, older = reading(contributor), reading(None)
    client.force_login(contributor)

    response = client.patch("/api/me", {"name": " Marion D. "}, content_type="application/json")
    assert response.json() == {"name": "Marion D."}
    mine.refresh_from_db(), older.refresh_from_db()
    assert (mine.author_name, older.author_name) == ("Marion D.", "Ancien")
    assert client.patch("/api/me", {"name": " "}, content_type="application/json").status_code == 422


def test_deleting_the_account_deletes_its_readings(client, contributor):
    reading(contributor), reading(None)
    client.force_login(contributor)

    assert client.delete("/api/me").status_code == 204
    assert not User.objects.exists()
    assert Reading.objects.get().author_name == "Ancien"
    assert client.get("/api/me").status_code == 401


def test_suspending_from_the_admin_hides_the_readings_and_ends_the_session(client, contributor, rf):
    mine = reading(contributor)
    client.force_login(contributor)

    account_admin = admin.site._registry[User]
    account_admin.suspend_and_hide(rf.post("/"), account_admin.get_queryset(rf.get("/")).filter(pk=contributor.pk))
    mine.refresh_from_db()
    assert mine.status == Reading.Status.HIDDEN
    assert client.get("/api/me").status_code == 401


def test_sign_in_link_command_prints_a_working_link(client):
    out = io.StringIO()
    call_command("sign_in_link", "Testeuse@Example.org", stdout=out)
    assert client.get(out.getvalue().strip()).url == "/?connexion=ok"
    assert User.objects.get().email == "testeuse@example.org"


def test_account_added_in_the_admin_without_email_signs_in(client):
    added = User.objects.create_user(username="marion@example.org")
    ask_link(client)
    assert client.get(mailed_link()).url == "/?connexion=ok"
    assert list(User.objects.all()) == [added]
