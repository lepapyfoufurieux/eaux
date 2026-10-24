import hashlib
import secrets
import uuid

from django.contrib.gis.db import models


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
    reference_reading = models.ForeignKey(
        "Reading",
        verbose_name="photo de référence",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
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
    author_name = models.CharField("auteur", max_length=60)
    station = models.ForeignKey(
        Station, null=True, blank=True, on_delete=models.SET_NULL, related_name="readings"
    )
    station_distance_m = models.FloatField("distance à la station (m)", null=True, blank=True)
    status = models.CharField("statut", max_length=10, choices=Status.choices, default=Status.PUBLISHED)
    # Lets the contributor edit or delete their reading without an account; only the hash is stored.
    edit_key_hash = models.CharField(max_length=64, editable=False)
    created_at = models.DateTimeField("reçu le", auto_now_add=True)

    class Meta:
        verbose_name = "relevé"
        ordering = ["-taken_at"]
        indexes = [models.Index(fields=["status", "taken_at"])]

    def __str__(self):
        return f"{self.get_flow_level_display()} · {self.taken_at:%d/%m/%Y} · {self.author_name}"

    @staticmethod
    def hash_key(key):
        return hashlib.sha256(key.encode()).hexdigest()

    def issue_edit_key(self):
        key = secrets.token_urlsafe(24)
        self.edit_key_hash = self.hash_key(key)
        return key

    def check_edit_key(self, key):
        return secrets.compare_digest(self.edit_key_hash, self.hash_key(key))
