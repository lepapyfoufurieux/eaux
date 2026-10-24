from django.contrib.gis import admin
from django.utils.html import format_html

from .models import Reading, Station


@admin.register(Station)
class StationAdmin(admin.GISModelAdmin):
    list_display = ["code", "name", "watercourse", "order", "active"]
    list_filter = ["active", "watercourse"]
    search_fields = ["code", "name"]
    raw_id_fields = ["reference_reading"]


@admin.register(Reading)
class ReadingAdmin(admin.GISModelAdmin):
    """Moderation happens here: hide a reading, or correct its station."""

    list_display = ["preview", "taken_at", "flow_level", "station", "station_distance_m", "author_name", "status"]
    list_filter = ["status", "flow_level", "station"]
    search_fields = ["author_name", "comment"]
    date_hierarchy = "taken_at"
    readonly_fields = ["preview", "created_at"]
    actions = ["hide", "publish"]

    @admin.display(description="photo")
    def preview(self, obj):
        return format_html('<img src="{}" style="height:48px;border-radius:4px">', obj.thumbnail.url) if obj.thumbnail else ""

    @admin.action(description="Masquer les relevés sélectionnés")
    def hide(self, request, queryset):
        queryset.update(status=Reading.Status.HIDDEN)

    @admin.action(description="Republier les relevés sélectionnés")
    def publish(self, request, queryset):
        queryset.update(status=Reading.Status.PUBLISHED)
