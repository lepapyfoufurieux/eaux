import uuid

from django.conf import settings
from django.contrib.gis.db import models
from django.db.models.signals import post_delete
from django.dispatch import receiver


class FlowLevel(models.TextChoices):
    """The four flow levels. Codes are stable; labels and colours live in the frontend too."""

    DRY = "dry", "Assec"
    VERY_LOW = "very_low", "Débit très faible"
    NORMAL = "normal", "Débit normal"
    HIGH = "high", "Débit important"


class Station(models.Model):
    """A fixed observation point shown on the river plan view (S01, S02…)."""

    code = models.CharField(max_length=10, unique=True)
    name = models.CharField("nom", max_length=100)
    watercourse = models.ForeignKey(
        "geo.Watercourse", verbose_name="cours d'eau", null=True, blank=True, on_delete=models.SET_NULL
    )
    location = models.PointField("position", geography=True)
    # Order along its watercourse, from upstream to downstream; drives the river plan layout.
    order = models.PositiveSmallIntegerField("ordre", default=0)
    active = models.BooleanField("active", default=True)

    class Meta:
        verbose_name = "station"
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} · {self.name}"


class Reading(models.Model):
    """One observation: a photo, a flow level, where and when it was taken."""

    class Status(models.TextChoices):
        PUBLISHED = "published", "Publié"
        HIDDEN = "hidden", "Masqué"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    photo = models.ImageField(upload_to="photos/%Y/%m/")
    thumbnail = models.ImageField(upload_to="thumbs/%Y/%m/")
    location = models.PointField("position", geography=True)
    taken_at = models.DateTimeField("prise le")
    flow_level = models.CharField("débit", max_length=10, choices=FlowLevel.choices)
    comment = models.TextField("commentaire", blank=True)
    # Copied from the account's name, and rewritten when it changes (accounts.api.set_name).
    author_name = models.CharField("auteur", max_length=60)
    # Empty for the readings published before accounts. Deleting an account deletes its readings.
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, verbose_name="compte", null=True, blank=True, on_delete=models.CASCADE, related_name="readings"
    )
    station = models.ForeignKey(
        Station, null=True, blank=True, on_delete=models.SET_NULL, related_name="readings"
    )
    station_distance_m = models.FloatField("distance à la station (m)", null=True, blank=True)
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.PUBLISHED)
    created_at = models.DateTimeField("reçu le", auto_now_add=True)

    class Meta:
        verbose_name = "relevé"
        ordering = ["-taken_at"]
        indexes = [models.Index(fields=["status", "taken_at"])]

    def __str__(self):
        return f"{self.get_flow_level_display()} · {self.taken_at:%d/%m/%Y} · {self.author_name}"


@receiver(post_delete, sender=Reading)
def delete_files(sender, instance, **kwargs):
    # Django keeps the files of deleted rows, and Caddy would keep serving them.
    instance.photo.delete(save=False)
    instance.thumbnail.delete(save=False)
