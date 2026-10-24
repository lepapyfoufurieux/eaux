"""Reference geography (IGN / OFB). Loaded once with `manage.py import_geodata`, edited by admins only."""

from django.contrib.gis.db import models


class Basin(models.Model):
    """Outline of the Saurat catchment. Photos taken outside it are refused."""

    name = models.CharField("nom", max_length=100, default="Bassin versant du Saurat")
    outline = models.MultiPolygonField("contour", srid=4326)

    class Meta:
        verbose_name = "bassin versant"
        verbose_name_plural = "bassins versants"

    def __str__(self):
        return self.name

    @classmethod
    def contains(cls, point):
        return cls.objects.filter(outline__contains=point).exists()


class Watercourse(models.Model):
    """A river or brook. `tributary_of` gives the branches of the river plan view."""

    name = models.CharField("nom", max_length=100)
    topage_code = models.CharField("code BD TOPAGE", max_length=20, blank=True)
    geometry = models.MultiLineStringField("tracé", srid=4326, null=True, blank=True)
    tributary_of = models.ForeignKey(
        "self",
        verbose_name="affluent de",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tributaries",
    )
    # Position of the confluence along the parent, from upstream (0) to downstream (1).
    confluence_position = models.FloatField("position du confluent", null=True, blank=True)

    class Meta:
        verbose_name = "cours d'eau"
        verbose_name_plural = "cours d'eau"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Spring(models.Model):
    class Origin(models.TextChoices):
        IGN = "ign", "IGN"
        OFB = "ofb", "OFB"

    kind = models.CharField("type", max_length=50)
    altitude_m = models.PositiveIntegerField("altitude (m)", null=True, blank=True)
    origin = models.CharField("origine", max_length=3, choices=Origin.choices)
    location = models.PointField("position", srid=4326)

    class Meta:
        verbose_name = "source"
        verbose_name_plural = "sources"

    def __str__(self):
        return f"{self.kind} ({self.get_origin_display()})"
