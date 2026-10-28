from django.contrib.gis import admin
from django.db.models import Count
from django.utils.html import format_html

from .models import Reading, Report, Station


@admin.register(Station)
class StationAdmin(admin.GISModelAdmin):
    list_display = ["code", "name", "watercourse", "order", "active"]
    list_filter = ["active", "watercourse"]
    search_fields = ["code", "name"]


class ReportInline(admin.TabularInline):
    model = Report
    extra = 0
    fields = ["reporter", "created_at"]
    readonly_fields = fields

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Reading)
class ReadingAdmin(admin.GISModelAdmin):
    """Moderation happens here: hide a reading, or correct its station.

    Hiding keeps the photo at its URL; to take a photo offline, delete the reading.
    """

    list_display = ["preview", "taken_at", "flow_level", "station", "station_distance_m", "author_name", "status", "report_count"]
    list_filter = ["status", "flow_level", "station"]
    search_fields = ["author_name", "comment", "owner__email"]
    # Lets an admin give a reading published before accounts back to its author's new account.
    raw_id_fields = ["owner"]
    date_hierarchy = "taken_at"
    readonly_fields = ["preview", "created_at"]
    inlines = [ReportInline]
    actions = ["hide", "publish"]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(report_count=Count("reports"))

    @admin.display(description="signalements", ordering="report_count")
    def report_count(self, obj):
        return obj.report_count or ""

    @admin.display(description="photo")
    def preview(self, obj):
        return format_html('<img src="{}" style="height:48px;border-radius:4px">', obj.thumbnail.url) if obj.thumbnail else ""

    @admin.action(description="Masquer les relevés sélectionnés", permissions=["change"])
    def hide(self, request, queryset):
        queryset.update(status=Reading.Status.HIDDEN)

    @admin.action(description="Republier les relevés sélectionnés", permissions=["change"])
    def publish(self, request, queryset):
        queryset.update(status=Reading.Status.PUBLISHED)
