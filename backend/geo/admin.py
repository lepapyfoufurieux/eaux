from django.contrib.gis import admin

from .models import Basin, Spring, Watercourse


@admin.register(Basin)
class BasinAdmin(admin.GISModelAdmin):
    list_display = ["name"]


@admin.register(Watercourse)
class WatercourseAdmin(admin.GISModelAdmin):
    list_display = ["name", "tributary_of", "topage_code"]
    search_fields = ["name", "topage_code"]


@admin.register(Spring)
class SpringAdmin(admin.GISModelAdmin):
    list_display = ["kind", "origin", "altitude_m"]
    list_filter = ["origin", "kind"]
