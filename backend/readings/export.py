"""CSV export for hydrologists (cahier des charges, section 2.5)."""

import csv

from django.http import StreamingHttpResponse

from .models import Reading

COLUMNS = ["date", "debit", "commentaire", "lat", "long", "station", "auteur"]


class Echo:
    def write(self, value):
        return value


def rows(readings):
    yield COLUMNS
    for r in readings:
        yield [
            r.taken_at.isoformat(),
            r.flow_level,
            r.comment,
            f"{r.location.y:.6f}",
            f"{r.location.x:.6f}",
            r.station.code if r.station else "",
            r.author_name,
        ]


def csv_response(readings, filename="eaux-de-saurat-releves.csv"):
    writer = csv.writer(Echo())
    response = StreamingHttpResponse(
        (writer.writerow(row) for row in rows(readings)), content_type="text/csv; charset=utf-8"
    )
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def published_readings(date_from=None, date_to=None):
    qs = Reading.objects.filter(status=Reading.Status.PUBLISHED).select_related("station").order_by("taken_at")
    if date_from:
        qs = qs.filter(taken_at__date__gte=date_from)
    if date_to:
        qs = qs.filter(taken_at__date__lte=date_to)
    return qs
