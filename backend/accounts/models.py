from django.contrib.admin.models import LogEntry
from django.db import models


class ModerationLog(LogEntry):
    """The admin's history under a clearer name: who hid, deleted, suspended or edited what, when and why."""

    class Meta:
        proxy = True
        verbose_name = "entrée du journal"
        verbose_name_plural = "journal de modération"


class BlockedDomain(models.Model):
    """E-mail domains refused at sign-in, mostly throwaway mailboxes used to make spam accounts. Subdomains are refused too."""

    domain = models.CharField("domaine", max_length=150, unique=True, help_text="Par exemple : yopmail.com")
    created_at = models.DateTimeField("ajouté le", auto_now_add=True)

    class Meta:
        verbose_name = "domaine e-mail bloqué"
        verbose_name_plural = "domaines e-mail bloqués"
        ordering = ["domain"]

    def __str__(self):
        return self.domain

    def save(self, *args, **kwargs):
        self.domain = self.domain.strip().lower().lstrip("@")
        super().save(*args, **kwargs)

    @classmethod
    def blocks(cls, email):
        domain = email.rpartition("@")[2].lower()
        parts = domain.split(".")
        # yopmail.com also blocks a.yopmail.com.
        return cls.objects.filter(domain__in=[".".join(parts[i:]) for i in range(len(parts) - 1)]).exists()
