# Architecture

This is the short version of the design document written with the project team (in French): [Eaux de Saurat — architecture du site](https://claude.ai/artifact/4CTAzr1yoHeMn4Hpm2dbRG).

## Principles

- **Easy to maintain for one volunteer.** Few moving parts, boring and long-lived tools, the Django admin instead of a custom back office.
- **One set of readings, two views.** The browser loads every published reading once (about 200 bytes each, no images) and both views compute from it.
- **The server checks what matters.** The browser reads EXIF and shrinks the photo, but the server re-checks that the point is inside the catchment, attaches the station and strips all metadata from the files it publishes.

## Request flow

```
Browser ──GET /api/readings, /api/stations, /api/geo/*──▶ Caddy ──▶ Django ──▶ PostGIS
        ──POST /api/readings (photo + fields, session)─▶ Caddy ──▶ Django ──▶ PostGIS + media/
        ──POST /api/auth/link (e-mail)─────────────────▶ Caddy ──▶ Django ──▶ SMTP ──▶ mailbox
        ◀──────────── /media/* (photos, thumbnails) ──── Caddy (files on disk)
```

## Data model

| Model | Key fields | Notes |
| --- | --- | --- |
| `readings.Reading` | photo, thumbnail, location, taken_at, flow_level, comment, author_name, owner, station, station_distance_m, status | One photo per reading. `status=hidden` is how admins moderate; deleting a reading also deletes its photo files. `owner` is empty for readings published before accounts; `author_name` is the account's name, rewritten when it changes. |
| `auth.User` (Django's) | email, first_name (display name), is_active | A contributor account. Inactive = suspended: no sign-in, open sessions end. Contributors have no password. |
| `readings.Station` | code (S01…), name, watercourse, location, order, active | Fixed points of the river plan. |
| `geo.Watercourse` | name, topage_code, geometry, tributary_of, confluence_position | `tributary_of` and `confluence_position` drive the river plan layout. |
| `geo.Spring` | kind, altitude_m, origin, location | IGN / OFB springs on the map. |
| `geo.Basin` | outline | Photos outside it are refused. |

Flow levels are stable codes: `dry`, `very_low`, `normal`, `high` (labels: Assec, Débit très faible, Débit normal, Débit important).

## Rules and where they live

| Rule | Where |
| --- | --- |
| Photo must be inside the catchment | `geo.models.Basin.contains` (server), `publish/form.ts` (early feedback) |
| A photo with GPS joins the nearest active station within 400 m; one without GPS is placed by hand (station, spring or watercourse) | `readings/attachment.py`, `readings/api.py`, `publish/form.ts` |
| Group photos whose spread is under 50 m | `frontend/src/domain/grouping.ts` |
| A station's state is its latest reading from the last two months | `frontend/src/domain/stationState.ts` |
| River plan layout from watercourses and station order | `frontend/src/domain/riverPlan.ts` |
| Only an active, signed-in account publishes; sign-in links are signed, single-use and valid 30 minutes | `accounts/api.py`, `readings/api.py` (`auth=django_auth`), `publish/form.ts` |
| Suspend an account and hide its readings; renaming an account renames its readings | `accounts/admin.py`, `accounts.api.set_name` |

Everything in `frontend/src/domain/` is free of DOM and Leaflet code, so it can be unit-tested and reused by both views.

## Accounts

Only signed-in contributors publish; reading stays public. Design document (in French): [Eaux de Saurat — architecture avec comptes](https://claude.ai/artifact/2Psru2HULaQ3KUcCp7ubp6).

- **Sign-in by e-mail link, no password.** `POST /api/auth/link` mails a signed, single-use link valid 30 minutes; the first sign-in creates the account. Sessions last a year per device. Mail goes out through the association's domain mailbox (SMTP settings in `.env`).
- **No new table.** Django's `User` holds the account (`email`, `first_name` = display name, `is_active`). `Reading` gains `owner` and loses `edit_key_hash`; `author_name` stays and is rewritten on all of an account's readings when its name changes.
- **Moderation after the fact, in the Django admin.** New accounts publish at once; admins can suspend an account (which ends its sessions), hide all its readings in one action, reactivate it or delete it with its readings and photo files.
- **API.** `/api/auth/link`, `/api/auth/login`, `/api/auth/logout`, `GET/PATCH/DELETE /api/me`; `POST /api/readings` requires a session (Django Ninja `django_auth`, CSRF header) and is limited to 30 per hour per account.

## Not built yet

- Edit and delete endpoints for a reading's owner, and a "Données personnelles" page.
- Station identity card, framing overlay, station time-lapse, station sponsors, Météo-France rain band (ideas kept from the brainstorm).
- Offline mode for the field.
