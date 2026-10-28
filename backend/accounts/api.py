"""Contributor accounts: sign in with a link or a code sent by e-mail, no password. The first sign-in creates the account."""

import secrets
from urllib.parse import urlencode

from django.conf import settings
from django.contrib.auth import get_user_model, login, logout
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponseRedirect
from django.middleware.csrf import get_token
from ninja import Router, Schema, Status
from ninja.errors import HttpError
from ninja.security import django_auth
from ninja.throttling import AnonRateThrottle

from readings.models import Reading

from .models import BlockedDomain

router = Router(tags=["accounts"])
User = get_user_model()
SALT = "accounts.login-link"
LINKS_PER_HOUR = 5
CODE_TRIES = 5
# The name is copied to Reading.author_name; the e-mail is the username, which holds 150 characters.
MAX_NAME_CHARS = 60
MAX_EMAIL_CHARS = 150

MESSAGE = """Bonjour,

Pour vous connecter au site Eaux de Saurat, tapez ce code dans le formulaire :

    {code}

ou ouvrez ce lien :

{link}

Le code et le lien sont valables 30 minutes et ne servent qu'une fois. Si vous n'avez rien demandé, ignorez ce message.
"""


class LinkIn(Schema):
    email: str


class CodeIn(Schema):
    email: str
    code: str


class NameIn(Schema):
    name: str


class MeOut(Schema):
    name: str
    email: str


def find_user(email):
    # An account added by hand in the admin may hold the address as its username only.
    return User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email)).first()


def last_login(user):
    # Part of the signed link: it changes at each sign-in, so a link works only once.
    return user.last_login.isoformat() if user and user.last_login else ""


def sign_in_path(email):
    """The path of a sign-in link for this address; the sign_in_link command prints it for testers."""
    token = signing.dumps({"email": email, "last": last_login(find_user(email))}, salt=SALT)
    return "/api/auth/login?" + urlencode({"token": token})


def open_session(request, email, user):
    """Signs in, creating the account at its first sign-in; a suspended account is refused. Returns the ?connexion= word."""
    if user is None:
        user = User.objects.create_user(username=email, email=email)
    elif not user.is_active:
        return "suspendu"
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return "ok"


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
    if BlockedDomain.blocks(email):
        raise HttpError(422, "Les adresses e-mail jetables ne sont pas acceptées : utilisez votre adresse habituelle.")
    # The same answer whether the account exists or not; the per-address limit keeps the site from flooding a mailbox.
    key = f"login-link:{email}"
    cache.add(key, 0, 3600)
    if cache.incr(key) <= LINKS_PER_HOUR:
        link = request.build_absolute_uri(sign_in_path(email))
        code = f"{secrets.randbelow(10**6):06d}"
        # Only the latest code counts; it goes once used, after 30 minutes or after CODE_TRIES wrong tries.
        cache.set(f"login-code:{email}", code, settings.LOGIN_LINK_MAX_AGE)
        cache.delete(f"login-code-tries:{email}")
        subject = f"{code} : votre code de connexion · Eaux de Saurat"
        send_mail(subject, MESSAGE.format(code=code, link=link), None, [email])
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
    return HttpResponseRedirect(f"/?connexion={open_session(request, data['email'], user)}")


@router.post("/auth/code", response={204: None}, throttle=[AnonRateThrottle("30/h")])
def sign_in_with_code(request, data: CodeIn):
    """The code typed in the form: on a phone, the mail app would open the link in another browser than the site's."""
    email = data.email.strip().lower()
    key, tries = f"login-code:{email}", f"login-code-tries:{email}"
    code = cache.get(key)
    if code is None:
        raise HttpError(400, "Ce code a expiré ou a déjà servi : demandez-en un nouveau.")
    if not secrets.compare_digest(code.encode(), data.code.strip().encode()):
        cache.add(tries, 0, settings.LOGIN_LINK_MAX_AGE)
        if cache.incr(tries) >= CODE_TRIES:
            cache.delete(key)
            raise HttpError(400, "Trop d'essais : demandez un nouveau code.")
        raise HttpError(400, "Ce code n'est pas le bon.")
    cache.delete(key)
    if open_session(request, email, find_user(email)) == "suspendu":
        raise HttpError(403, "Ce compte est suspendu. Contactez l'association.")
    return Status(204, None)


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
    return {"name": request.user.first_name, "email": request.user.email}


@router.patch("/me", auth=django_auth, response=MeOut)
def rename(request, data: NameIn):
    name = data.name.strip()
    if not name:
        raise HttpError(422, "Indiquez votre nom ou prénom.")
    if len(name) > MAX_NAME_CHARS:
        raise HttpError(422, f"Le nom dépasse {MAX_NAME_CHARS} caractères.")
    set_name(request.user, name)
    return {"name": name, "email": request.user.email}


@router.delete("/me", auth=django_auth, response={204: None})
def delete_account(request):
    """Deletes the account and its readings; the readings' signal removes their photo files."""
    user = request.user
    logout(request)
    user.delete()
    return Status(204, None)
