from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin
from django.core.exceptions import PermissionDenied
from django.db.models import Count
from django.urls import reverse
from django.utils.html import format_html

from readings.models import Reading

from .api import set_name

User = get_user_model()
admin.site.unregister(User)


@admin.register(User)
class AccountAdmin(UserAdmin):
    """Accounts are moderated after the fact: suspend the one that abuses, and hide its readings in one go.

    A suspended account (inactive) can no longer sign in, and its open sessions end at their next request.
    """

    list_display = ["email", "first_name", "date_joined", "last_login", "reading_count", "is_active", "is_staff"]
    list_filter = ["is_active", "is_staff"]
    search_fields = ["email", "first_name", "username"]
    ordering = ["-date_joined"]
    actions = ["suspend_and_hide", "suspend", "reactivate"]
    # What a moderator sees and edits: never the staff, superuser or permission boxes, which would let them raise their own rights.
    moderator_fieldsets = [(None, {"fields": ["email", "first_name", "is_active", "last_login", "date_joined"]})]

    def get_fieldsets(self, request, obj=None):
        return super().get_fieldsets(request, obj) if request.user.is_superuser or obj is None else self.moderator_fieldsets

    def get_readonly_fields(self, request, obj=None):
        return [] if request.user.is_superuser else ["last_login", "date_joined"]

    def has_change_permission(self, request, obj=None):
        # Moderators handle contributors only, not the association's staff accounts.
        if obj is not None and obj.is_staff and not request.user.is_superuser:
            return False
        return super().has_change_permission(request, obj)

    def user_change_password(self, request, id, form_url=""):
        # Contributors sign in without a password; only an admin sets one, for a staff account.
        if not request.user.is_superuser:
            raise PermissionDenied
        return super().user_change_password(request, id, form_url)

    def contributors(self, request, queryset):
        return queryset if request.user.is_superuser else queryset.filter(is_staff=False)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(reading_count=Count("readings"))

    @admin.display(description="relevés", ordering="reading_count")
    def reading_count(self, obj):
        url = reverse("admin:readings_reading_changelist") + f"?owner__id__exact={obj.pk}"
        return format_html('<a href="{}">{}</a>', url, obj.reading_count)

    def save_model(self, request, obj, form, change):
        renamed = change and "first_name" in form.changed_data
        super().save_model(request, obj, form, change)
        if renamed:
            set_name(obj, obj.first_name)

    @admin.action(description="Suspendre et masquer leurs relevés", permissions=["change"])
    def suspend_and_hide(self, request, queryset):
        queryset = self.contributors(request, queryset)
        queryset.update(is_active=False)
        Reading.objects.filter(owner__in=queryset).update(status=Reading.Status.HIDDEN)

    @admin.action(description="Suspendre (les relevés restent en ligne)", permissions=["change"])
    def suspend(self, request, queryset):
        self.contributors(request, queryset).update(is_active=False)

    @admin.action(description="Réactiver (les relevés masqués le restent)", permissions=["change"])
    def reactivate(self, request, queryset):
        self.contributors(request, queryset).update(is_active=True)
