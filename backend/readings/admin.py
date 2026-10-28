from collections import defaultdict

from django import forms
from django.contrib import messages
from django.contrib.admin import ActionLocation, helpers
from django.contrib.gis import admin
from django.core.mail import send_mail
from django.db.models import Count
from django.template.response import TemplateResponse
from django.utils import timezone
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


REASONS = [
    ("blurry", "Photo floue ou trop sombre"),
    ("not_river", "La photo ne montre pas le cours d'eau"),
    ("outside", "Photo prise hors du bassin versant"),
    ("wrong_place", "Photo placée au mauvais endroit"),
    ("duplicate", "Doublon d'une autre photo"),
    ("people", "Une personne est reconnaissable"),
    ("inappropriate", "Contenu inapproprié"),
    ("other", "Autre raison (précisée ci-dessous)"),
]

NOTICE = """Bonjour{name},

L'association Eaux de Saurat a {done} {photos} :

{readings}

Motif : {reason}
{message}
Vous pouvez répondre à ce message pour en parler.
"""


class ReasonForm(forms.Form):
    reason = forms.ChoiceField(label="Motif", choices=REASONS, widget=forms.RadioSelect)
    message = forms.CharField(label="Précision pour le contributeur (facultatif)", required=False, widget=forms.Textarea(attrs={"rows": 3}))

    def clean(self):
        data = super().clean()
        if data.get("reason") == "other" and not data.get("message", "").strip():
            self.add_error("message", "Précisez la raison.")
        return data


def notices(readings, done, form):
    """One e-mail per contributor, listing their readings; readings published before accounts have no one to tell."""
    by_owner = defaultdict(list)
    for r in readings:
        if r.owner and r.owner.email:
            by_owner[r.owner].append(r)
    reason = dict(REASONS)[form.cleaned_data["reason"]]
    message = form.cleaned_data["message"].strip()
    for owner, mine in by_owner.items():
        lines = [
            f"- {timezone.localtime(r.taken_at):%d/%m/%Y à %H:%M}" + (f", {r.station.code} · {r.station.name}" if r.station else "")
            for r in mine
        ]
        body = NOTICE.format(
            name=f" {owner.first_name}" if owner.first_name else "",
            done=done,
            photos="votre photo" if len(mine) == 1 else f"vos {len(mine)} photos",
            readings="\n".join(lines),
            reason=reason if form.cleaned_data["reason"] != "other" else message,
            message=f"\n{message}\n" if message and form.cleaned_data["reason"] != "other" else "",
        )
        yield owner.email, body


@admin.register(Reading)
class ReadingAdmin(admin.GISModelAdmin):
    """Moderation happens here: hide or delete a reading, giving the contributor a reason by e-mail, or correct its station.

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
    actions = ["hide", "delete_with_reason", "publish"]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(report_count=Count("reports"))

    @admin.display(description="signalements", ordering="report_count")
    def report_count(self, obj):
        return obj.report_count or ""

    @admin.display(description="photo")
    def preview(self, obj):
        return format_html('<img src="{}" style="height:48px;border-radius:4px">', obj.thumbnail.url) if obj.thumbnail else ""

    def get_actions(self, request, action_location=ActionLocation.CHANGE_LIST):
        # Replaced by delete_with_reason, which tells the contributor why.
        actions = super().get_actions(request, action_location)
        actions.pop("delete_selected", None)
        return actions

    @admin.action(description="Masquer les relevés sélectionnés (avec un motif)", permissions=["change"])
    def hide(self, request, queryset):
        queryset = queryset.filter(status=Reading.Status.PUBLISHED)
        return self.with_reason(request, queryset, "hide", "masquer", "masqué", lambda: queryset.update(status=Reading.Status.HIDDEN))

    @admin.action(description="Supprimer les relevés sélectionnés (avec un motif)", permissions=["delete"])
    def delete_with_reason(self, request, queryset):
        return self.with_reason(request, queryset, "delete_with_reason", "supprimer", "supprimé", queryset.delete)

    def with_reason(self, request, queryset, action, verb, done, apply):
        """First shows the reason form; once sent, applies the action and mails each contributor the reason."""
        form = ReasonForm(request.POST if "apply" in request.POST else None)
        readings = list(queryset.select_related("owner", "station"))
        if form.is_valid():
            mails = list(notices(readings, done, form))
            apply()
            try:
                for to, body in mails:
                    send_mail(f"Votre photo a été {done}e · Eaux de Saurat", body, None, [to])
            except Exception as error:
                self.message_user(request, f"{len(readings)} relevé(s) {done}(s), mais l'e-mail n'est pas parti : {error}", messages.WARNING)
            else:
                self.message_user(request, f"{len(readings)} relevé(s) {done}(s), {len(mails)} contributeur(s) prévenu(s) par e-mail.")
            return None
        return TemplateResponse(request, "admin/readings/reading/reason.html", {
            **self.admin_site.each_context(request),
            "title": f"Pourquoi {verb} ces relevés ?",
            "opts": self.model._meta,
            "form": form,
            "readings": readings,
            "action": action,
            "verb": verb,
            "action_checkbox_name": helpers.ACTION_CHECKBOX_NAME,
        })

    @admin.action(description="Republier les relevés sélectionnés", permissions=["change"])
    def publish(self, request, queryset):
        queryset.update(status=Reading.Status.PUBLISHED)
