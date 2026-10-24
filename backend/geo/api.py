"""Reference layers as GeoJSON. They change rarely, so the browser may cache them for a day."""

import json

from django.http import HttpResponse
from ninja import Router

from .models import Basin, Spring, Watercourse

router = Router(tags=["geo"])
CACHE_HEADER = "public, max-age=86400"


def feature_collection(features):
    response = HttpResponse(
        json.dumps({"type": "FeatureCollection", "features": features}),
        content_type="application/geo+json",
    )
    response["Cache-Control"] = CACHE_HEADER
    return response


def feature(geometry, **properties):
    return {
        "type": "Feature",
        "geometry": json.loads(geometry.geojson) if geometry else None,
        "properties": properties,
    }


@router.get("/basin")
def basin(request):
    return feature_collection([feature(b.outline, name=b.name) for b in Basin.objects.all()])


@router.get("/watercourses")
def watercourses(request):
    return feature_collection(
        [
            feature(
                w.geometry,
                id=w.id,
                name=w.name,
                tributary_of=w.tributary_of_id,
                confluence_position=w.confluence_position,
            )
            # Watercourses without a drawn line still count: the river plan needs them.
            for w in Watercourse.objects.all()
        ]
    )


@router.get("/springs")
def springs(request):
    return feature_collection(
        [
            feature(s.location, kind=s.kind, altitude_m=s.altitude_m, origin=s.get_origin_display())
            for s in Spring.objects.all()
        ]
    )
