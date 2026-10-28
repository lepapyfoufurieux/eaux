from django.apps import AppConfig
from django.db.models.signals import post_migrate

MODERATORS = "Modérateurs"
# Hide, delete and republish readings, clear reports, suspend and reactivate accounts, keep stations, watercourses and springs up to date.
# The catchment outline, staff accounts and rights stay with the admins.
MODERATOR_PERMISSIONS = [
    ("readings", "view_reading"),
    ("readings", "change_reading"),
    ("readings", "delete_reading"),
    ("readings", "view_report"),
    ("readings", "delete_report"),
    *[(app, f"{action}_{model}") for app, model in [("readings", "station"), ("geo", "watercourse"), ("geo", "spring")]
      for action in ["view", "add", "change", "delete"]],
    ("auth", "view_user"),
    ("auth", "change_user"),
]


def create_moderators(sender, **kwargs):
    """Kept in step with MODERATOR_PERMISSIONS at each migrate; an admin adds people to the group and ticks "staff"."""
    from django.contrib.auth.models import Group, Permission

    group, _ = Group.objects.get_or_create(name=MODERATORS)
    perms = [Permission.objects.get(content_type__app_label=app, codename=codename) for app, codename in MODERATOR_PERMISSIONS]
    group.permissions.set(perms)


class AccountsConfig(AppConfig):
    name = "accounts"
    verbose_name = "Comptes"

    def ready(self):
        # Sent after each app's permissions exist; readings comes after accounts in INSTALLED_APPS, so wait for it.
        post_migrate.connect(create_moderators, sender=self.apps.get_app_config("readings"))
