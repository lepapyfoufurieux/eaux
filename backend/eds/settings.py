"""Django settings for Eaux de Saurat. Everything that differs between machines comes from the environment."""

import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env_list(name, default=""):
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-only-not-secret")
# Off unless asked for: a forgotten variable must not put a public site in debug mode.
DEBUG = os.environ.get("DJANGO_DEBUG", "false").lower() == "true"
# Both values are public (this file, .env.example): outside debug they would let anyone sign Django data.
if not DEBUG and SECRET_KEY in ("dev-only-not-secret", "change-me"):
    raise ImproperlyConfigured("Set DJANGO_SECRET_KEY in .env to a long random value (or DJANGO_DEBUG=true to develop).")
ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
CSRF_TRUSTED_ORIGINS = [f"https://{host}" for host in ALLOWED_HOSTS]

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "geo",
    "readings",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "eds.urls"
WSGI_APPLICATION = "eds.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.contrib.gis.db.backends.postgis",
        "NAME": os.environ.get("POSTGRES_DB", "eaux"),
        "USER": os.environ.get("POSTGRES_USER", "eaux"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "eaux"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "fr-fr"
TIME_ZONE = "Europe/Paris"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# The browser already shrinks photos to 1600 px (about 300 KB); this is a safety net.
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024
MAX_PHOTO_BYTES = 8 * 1024 * 1024

# Same value in frontend/src/publish/form.ts, which tells the contributor which station the photo will join.
STATION_ATTACH_RADIUS_M = 400

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# The upload limit counts in this cache: a file cache is shared by the gunicorn workers, a memory one is not.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.filebased.FileBasedCache", "LOCATION": "/tmp/eds-cache"}}

# Caddy sits in front of Django: trust one X-Forwarded-For hop when throttling by IP.
NINJA_NUM_PROXIES = 1
