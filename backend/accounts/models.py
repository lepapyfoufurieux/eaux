from django.contrib.admin.models import LogEntry


class ModerationLog(LogEntry):
    """The admin's history under a clearer name: who hid, deleted, suspended or edited what, when and why."""

    class Meta:
        proxy = True
        verbose_name = "entrée du journal"
        verbose_name_plural = "journal de modération"
