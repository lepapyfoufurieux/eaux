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


def mailed_code():
    return re.search(r"^    (\d{6})$", mail.outbox[-1].body, re.M).group(1)


def send_code(client, code, email="marion@example.org"):
    return client.post("/api/auth/code", {"email": email, "code": code}, content_type="application/json")


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
    assert client.get("/api/me").json() == {"name": "", "email": "marion@example.org"}


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
    assert response.json() == {"name": "Marion D.", "email": "marion@example.org"}
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
    request = rf.post("/")
    request.user = User.objects.create_superuser(username="admin", email="admin@example.org", password="x")
    account_admin.suspend_and_hide(request, account_admin.get_queryset(rf.get("/")).filter(pk=contributor.pk))
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


def test_mailed_code_signs_in_once(client):
    ask_link(client)
    code = mailed_code()
    assert code in mail.outbox[-1].subject
    assert send_code(client, code, " Marion@Example.org ").status_code == 204
    assert client.get("/api/me").json()["email"] == "marion@example.org"

    client.logout()
    assert send_code(client, code).status_code == 400
    assert client.get("/api/me").status_code == 401


def test_only_the_latest_code_counts(client):
    ask_link(client)
    first = mailed_code()
    ask_link(client)
    latest = mailed_code()
    if first != latest:
        assert send_code(client, first).status_code == 400
    assert send_code(client, latest).status_code == 204


def test_wrong_codes_wipe_the_code(client):
    ask_link(client)
    code = mailed_code()
    wrong = f"{(int(code) + 1) % 10**6:06d}"
    for _ in range(5):
        assert send_code(client, wrong).status_code == 400
    assert send_code(client, code).status_code == 400
    assert client.get("/api/me").status_code == 401


def test_suspended_account_cannot_sign_in_with_a_code(client, contributor):
    contributor.is_active = False
    contributor.save()
    ask_link(client)
    assert send_code(client, mailed_code()).status_code == 403
    assert client.get("/api/me").status_code == 401


def test_my_readings_lists_only_mine_hidden_ones_included(client, contributor):
    mine = reading(contributor, status=Reading.Status.HIDDEN, photo="photos/a.jpg", thumbnail="thumbs/a.jpg")
    reading(None)
    assert client.get("/api/me/readings").status_code == 401

    client.force_login(contributor)
    listed = client.get("/api/me/readings").json()
    assert [(r["id"], r["status"]) for r in listed] == [(str(mine.id), "hidden")]


def test_a_contributor_deletes_only_their_own_readings(client, contributor):
    mine, other = reading(contributor), reading(None)
    assert client.delete(f"/api/me/readings/{mine.id}").status_code == 401

    client.force_login(contributor)
    assert client.delete(f"/api/me/readings/{other.id}").status_code == 404
    assert client.delete(f"/api/me/readings/{mine.id}").status_code == 204
    assert list(Reading.objects.all()) == [other]


@pytest.fixture
def moderator(db):
    from django.contrib.auth.models import Group

    user = User.objects.create_user(username="modo@example.org", email="modo@example.org", is_staff=True)
    user.groups.add(Group.objects.get(name="Modérateurs"))
    return user


def test_moderators_moderate_and_keep_the_map_data_but_not_staff_accounts(client, moderator, contributor):
    mine = reading(contributor, photo="photos/a.jpg", thumbnail="thumbs/a.jpg")
    boss = User.objects.create_superuser(username="admin", email="admin@example.org", password="x")
    client.force_login(moderator)

    assert client.get("/admin/readings/reading/").status_code == 200
    for page in ["readings/station", "geo/watercourse", "geo/spring", "readings/station/add", "geo/spring/add"]:
        assert client.get(f"/admin/{page}/").status_code == 200, page
    assert client.get("/admin/geo/basin/").status_code == 403
    client.post("/admin/readings/reading/", {"action": "hide", "_selected_action": [mine.pk], "apply": "1", "reason": "blurry"})
    mine.refresh_from_db()
    assert mine.status == Reading.Status.HIDDEN

    # The change form offers no staff or superuser box: posting one changes nothing.
    url = f"/admin/auth/user/{contributor.pk}/change/"
    form = {"email": contributor.email, "first_name": "Marion", "is_active": "on", "is_superuser": "on", "is_staff": "on"}
    assert client.post(url, form).status_code == 302
    contributor.refresh_from_db()
    assert not (contributor.is_staff or contributor.is_superuser)
    assert client.get(f"/admin/auth/user/{contributor.pk}/password/").status_code == 403

    # Staff accounts are out of reach, even through the bulk actions.
    assert client.post(f"/admin/auth/user/{boss.pk}/change/", {"email": boss.email, "is_active": ""}).status_code == 403
    client.post("/admin/auth/user/", {"action": "suspend", "_selected_action": [boss.pk, contributor.pk]})
    boss.refresh_from_db(), contributor.refresh_from_db()
    assert (boss.is_active, contributor.is_active) == (True, False)

    # Everything above is in the moderation log, which the moderator reads but cannot change.
    log = client.get("/admin/accounts/moderationlog/")
    assert log.status_code == 200 and "Suspendu." in log.text and "Motif : Photo floue ou trop sombre" in log.text
    assert client.post("/admin/accounts/moderationlog/1/delete/").status_code == 403


def test_throwaway_addresses_are_refused(client):
    from accounts.models import BlockedDomain

    assert ask_link(client, "spam@yopmail.com").status_code == 422
    assert ask_link(client, "spam@x.Mailinator.com").status_code == 422
    BlockedDomain.objects.create(domain=" @Spam.example ")
    assert ask_link(client, "a@spam.example").status_code == 422
    assert ask_link(client, "a@notspam.example").status_code == 204
    assert len(mail.outbox) == 1
