"""Write data/watercourses.geojson and data/springs.geojson, clipped to data/basin.geojson.

Watercourses are the BD TOPAGE network as published in BD TOPO, one feature per BD TOPAGE
watercourse code. Springs are the BD TOPO "Source" points (IGN) and the BD TOPAGE network's
source nodes (co-produced with the OFB).

    python data/prepare_layers.py       # after prepare_basin.py; caches downloads in data/raw/
"""

import json
import urllib.parse
from collections import Counter, defaultdict

from prepare_basin import DATA, EAST, GEOPF, NORTH, SOUTH, WEST, cell, download, elevation, inside

# Canals, aqueducts and reservoirs are not brooks people photograph; buried pipes keep the lines continuous.
NATURES = {"Ecoulement naturel", "Conduit buse"}
UNNAMED = "Cours d'eau sans nom"


def wfs(layer):
    query = urllib.parse.urlencode({
        "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
        "TYPENAMES": f"BDTOPO_V3:{layer}", "OUTPUTFORMAT": "application/json",
        "SRSNAME": "EPSG:4326", "BBOX": f"{SOUTH},{WEST},{NORTH},{EAST},urn:ogc:def:crs:EPSG::4326",
        "COUNT": 5000,
    })
    name = "saurat-watercourses.geojson" if layer == "troncon_hydrographique" else f"saurat-{layer}.geojson"
    return json.loads(download(name, f"{GEOPF}/wfs/ows?{query}").read_text("utf-8"))["features"]


def capitalise(name):
    return name[:1].upper() + name[1:] if name else name


def clip(line, ring):
    """The runs of consecutive vertices inside the ring, each kept if it is still a line."""
    runs, run = [], []
    for point in line:
        if inside(point[:2], ring):
            run.append(point[:2])
        else:
            runs.append(run)
            run = []
    runs.append(run)
    return [r for r in runs if len(r) > 1]


def watercourses(ring):
    lines, codes = defaultdict(list), defaultdict(Counter)
    for f in wfs("troncon_hydrographique"):
        p = f["properties"]
        if p["nature"] not in NATURES or p["fictif"]:
            continue
        g = f["geometry"]
        parts = [run for line in ([g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]) for run in clip(line, ring)]
        if not parts:
            continue
        # By name, so the Saurat's last metres (a second code) stay one watercourse; unnamed ones by code,
        # and those with neither share one feature. "Ruisseau du Rade/Ruisseau du Courtalet": the first name is its own.
        name = capitalise((p["cpx_toponyme_de_cours_d_eau"] or "").split("/")[0])
        key = name or p["code_du_cours_d_eau_bdcarthage"] or ""
        lines[key] += parts
        if p["code_du_cours_d_eau_bdcarthage"]:
            codes[key][p["code_du_cours_d_eau_bdcarthage"]] += len(parts)
    features = []
    for key, parts in lines.items():
        name = key if key and key not in codes[key] else UNNAMED
        code = codes[key].most_common(1)[0][0] if codes[key] else ""
        features.append({
            "type": "Feature",
            "properties": {"name": name, "code": code},
            "geometry": {"type": "MultiLineString", "coordinates": parts},
        })
    return features


def springs(ring):
    z = elevation()
    features = []
    for f in wfs("detail_hydrographique"):
        p = f["properties"]
        point = f["geometry"]["coordinates"][:2]
        if p["nature"] not in ("Source", "Source captée") or not inside(point, ring):
            continue
        row, col = cell(*point)
        kind = p["nature"] + (f" ({p['toponyme']})" if p["toponyme"] else "")
        features.append(spring(point, kind, round(z[row, col]), "ign"))
    for f in wfs("noeud_hydrographique"):
        coordinates = f["geometry"]["coordinates"]
        if f["properties"]["categorie"] != "Source" or not inside(coordinates[:2], ring):
            continue
        row, col = cell(*coordinates[:2])
        altitude = round(coordinates[2]) if len(coordinates) > 2 and coordinates[2] > 0 else round(z[row, col])
        features.append(spring(coordinates[:2], "Tête de cours d'eau", altitude, "ofb"))
    return features


def spring(point, kind, altitude_m, origin):
    return {
        "type": "Feature",
        "properties": {"kind": kind[:50], "altitude_m": altitude_m, "origin": origin},
        "geometry": {"type": "Point", "coordinates": point},
    }


def write(name, features):
    collection = {"type": "FeatureCollection", "features": features}
    (DATA / name).write_text(json.dumps(collection, ensure_ascii=False) + "\n", "utf-8")


def main():
    ring = json.loads((DATA / "basin.geojson").read_text("utf-8"))["features"][0]["geometry"]["coordinates"][0]
    rivers = watercourses(ring)
    sources = springs(ring)
    # Self-checks: the Saurat is there with its code, and nothing outside the basin was kept.
    assert any(f["properties"]["name"] == "Le Saurat" and f["properties"]["code"] == "O1220500" for f in rivers)
    assert all(inside(p, ring) for f in rivers for line in f["geometry"]["coordinates"] for p in line)
    assert all(inside(f["geometry"]["coordinates"], ring) for f in sources)
    write("watercourses.geojson", rivers)
    write("springs.geojson", sources)
    print(f"watercourses.geojson: {len(rivers)} cours d'eau; springs.geojson: {len(sources)} sources")


if __name__ == "__main__":
    main()
