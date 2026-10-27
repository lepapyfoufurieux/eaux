"""Contributor accounts: sign in with a link sent by e-mail, no password. The first sign-in creates the account."""

from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import transaction
from django.http import HttpResponseRedirect
from django.middleware.csrf import get_token
from ninja import Router, Schema, Status
from ninja.errors import HttpError
from ninja.security import django_auth
from ninja.throttling import AnonRateThrottle

from readings.models import Reading

router = Router(tags=["accounts"])
User = get_user_model()
SALT = "accounts.login-link"
LINKS_PER_HOUR = 5
# The name is copied to Reading.author_name; the e-mail is the username, which holds 150 characters.
MAX_NAME_CHARS = 60
MAX_EMAIL_CHARS = 150

MESSAGE = """Bonjour,

Pour vous connecter au site Eaux de Saurat, ouvrez ce lien :

{link}

Il est valable 30 minutes et ne sert qu'une fois. Si vous n'avez rien demandé, ignorez ce message.
"""


class LinkIn(Schema):
    email: str


class NameIn(Schema):
    name: str


class MeOut(Schema):
    name: str


def find_user(email):
    return User.objects.filter(email__iexact=email).first()


def last_login(user):
    # Part of the signed link: it changes at each sign-in, so a link works only once.
    return user.last_login.isoformat() if user and user.last_login else ""


def sign_in_path(email):
    """The path of a sign-in link for this address; the sign_in_link command prints it for testers."""
    token = signing.dumps({"email": email, "last": last_login(find_user(email))}, salt=SALT)
    return "/api/auth/login?" + urlencode({"token": token})


def set_name(user, name):
    """The name shown under the photos; changing it renames the account's readings already published."""
    with transaction.atomic():
        user.first_name = name
        user.save(update_fields=["first_name"])
        Reading.objects.filter(owner=user).update(author_name=name)


@router.post("/auth/link", response={204: None}, throttle=[AnonRateThrottle(f"{LINKS_PER_HOUR}/h")])
def send_link(request, data: LinkIn):
    email = data.email.strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        raise HttpError(422, "Cette adresse e-mail n'est pas valide.")
    if len(email) > MAX_EMAIL_CHARS:
        raise HttpError(422, "Cette adresse e-mail est trop longue.")
    # The same answer whether the account exists or not; the per-address limit keeps the site from flooding a mailbox.
    key = f"login-link:{email}"
    cache.add(key, 0, 3600)
    if cache.incr(key) <= LINKS_PER_HOUR:
        link = request.build_absolute_uri(sign_in_path(email))
        send_mail("Votre lien de connexion · Eaux de Saurat", MESSAGE.format(link=link), None, [email])
    return Status(204, None)


@router.get("/auth/login")
def sign_in(request, token: str):
    """The link in the e-mail: opens the session, then back to the site, whose publish form reads ?connexion=."""
    try:
        data = signing.loads(token, salt=SALT, max_age=settings.LOGIN_LINK_MAX_AGE)
    except signing.BadSignature:
        return HttpResponseRedirect("/?connexion=invalide")
    user = find_user(data["email"])
    if data["last"] != last_login(user):
        return HttpResponseRedirect("/?connexion=invalide")
    if user is None:
        user = User.objects.create_user(username=data["email"], email=data["email"])
    elif not user.is_active:
        return HttpResponseRedirect("/?connexion=suspendu")
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return HttpResponseRedirect("/?connexion=ok")


@router.post("/auth/logout", auth=django_auth, response={204: None})
def sign_out(request):
    logout(request)
    return Status(204, None)


@router.get("/me", response={200: MeOut, 401: None})
def me(request):
    # Sets the CSRF cookie the browser sends back, as the X-CSRFToken header, with each write.
    get_token(request)
    if not request.user.is_authenticated:
        return Status(401, None)
    return {"name": request.user.first_name}


@router.patch("/me", auth=django_auth, response=MeOut)
def rename(request, data: NameIn):
    name = data.name.strip()
    if not name:
        raise HttpError(422, "Indiquez votre nom ou prénom.")
    if len(name) > MAX_NAME_CHARS:
        raise HttpError(422, f"Le nom dépasse {MAX_NAME_CHARS} caractères.")
    set_name(request.user, name)
    return {"name": name}


@router.delete("/me", auth=django_auth, response={204: None})
def delete_account(request):
    """Deletes the account and its readings; the readings' signal removes their photo files."""
    user = request.user
    logout(request)
    user.delete()
    return Status(204, None)
