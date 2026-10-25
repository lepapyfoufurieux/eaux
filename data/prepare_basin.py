"""Compute the Saurat's topographic catchment and write data/basin.geojson (EPSG:4326).

BD TOPAGE's catchments stop at hydrographic zones: the Saurat (O1220500) lies inside zone
O122, which also holds the Ariège valley from Tarascon to Arnave. So the outline is computed
here, upstream of the Saurat's confluence with the Ariège, from the IGN elevation model
(RGE ALTI) with the BD TOPAGE watercourses (as published in BD TOPO) burnt into it.

    python data/prepare_basin.py        # needs numpy and access to data.geopf.fr

Downloads are cached in data/raw/ (ignored by git); delete them to fetch fresh data.
"""

import heapq
import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

DATA = Path(__file__).parent
RAW = DATA / "raw"
SOUTH, WEST, NORTH, EAST = 42.83, 1.43, 42.93, 1.63
WIDTH, HEIGHT = 1600, 1100  # about 10 m cells
DLNG, DLAT = (EAST - WEST) / WIDTH, (NORTH - SOUTH) / HEIGHT
# Last BD TOPAGE vertex of the Saurat before it meets the Ariège in Tarascon.
OUTLET = (1.60197471, 42.86016873)
BURN_M = 10
# Phone GPS is off by 10-30 m, and the Saurat's last metres run along the outline itself:
# widen the catchment by this many cells (about 30 m) so photos taken on its banks pass.
MARGIN_CELLS = 3
GEOPF = "https://data.geopf.fr"


def download(name, url):
    path = RAW / name
    if not path.exists():
        RAW.mkdir(exist_ok=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            path.write_bytes(response.read())
    return path


def elevation():
    query = urllib.parse.urlencode({
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "STYLES": "",
        "LAYERS": "ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES", "CRS": "EPSG:4326",
        "BBOX": f"{SOUTH},{WEST},{NORTH},{EAST}", "WIDTH": WIDTH * 2, "HEIGHT": HEIGHT * 2,
        "FORMAT": "image/x-bil;bits=32",
    })
    path = download("saurat-elevation-x2.bil", f"{GEOPF}/wms-r/wms?{query}")
    z = np.fromfile(path, "<f4").reshape(HEIGHT, 2, WIDTH, 2).astype(np.float64).mean(axis=(1, 3))
    # The service's resampling leaves small steps along rows; on gentle slopes they would steer
    # the flow along the grid. A 3x3 mean removes them and moves ridges by 10 m at most.
    padded = np.pad(z, 1, mode="edge")
    return sum(padded[1 + dr : 1 + dr + HEIGHT, 1 + dc : 1 + dc + WIDTH] for dr, dc in NEIGHBOURS + [(0, 0)]) / 9


def watercourses():
    query = urllib.parse.urlencode({
        "SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature",
        "TYPENAMES": "BDTOPO_V3:troncon_hydrographique", "OUTPUTFORMAT": "application/json",
        "SRSNAME": "EPSG:4326", "BBOX": f"{SOUTH},{WEST},{NORTH},{EAST},urn:ogc:def:crs:EPSG::4326",
        "COUNT": 5000,
    })
    features = json.loads(download("saurat-watercourses.geojson", f"{GEOPF}/wfs/ows?{query}").read_text("utf-8"))["features"]
    # Canals, aqueducts and buried pipes cross ridges; burning them would join catchments.
    natural = [f for f in features if f["properties"]["nature"] == "Ecoulement naturel" and f["properties"]["position_par_rapport_au_sol"] == "0"]
    lines = []
    for f in natural:
        g = f["geometry"]
        for line in [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]:
            lines.append((f["properties"].get("cpx_toponyme_de_cours_d_eau"), [p[:2] for p in line]))
    return lines


def cell(lng, lat):
    return int((NORTH - lat) / DLAT), int((lng - WEST) / DLNG)


def burn(z, lines):
    for _, line in lines:
        for (x1, y1), (x2, y2) in zip(line, line[1:]):
            steps = max(2, int(max(abs(x2 - x1) / DLNG, abs(y2 - y1) / DLAT) * 2))
            for t in np.linspace(0, 1, steps):
                r, c = cell(x1 + t * (x2 - x1), y1 + t * (y2 - y1))
                if 0 <= r < HEIGHT and 0 <= c < WIDTH:
                    z[r, c] = min(z[r, c], z[r, c] - BURN_M)


NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def fill(z):
    """Priority-flood: raise every pit so that water can always run to the grid's edge."""
    z = z.copy()
    done = np.zeros(z.shape, bool)
    heap = []
    for r in range(HEIGHT):
        for c in range(WIDTH):
            if r in (0, HEIGHT - 1) or c in (0, WIDTH - 1):
                heap.append((z[r, c], r, c))
                done[r, c] = True
    heapq.heapify(heap)
    while heap:
        h, r, c = heapq.heappop(heap)
        for dr, dc in NEIGHBOURS:
            nr, nc = r + dr, c + dc
            if 0 <= nr < HEIGHT and 0 <= nc < WIDTH and not done[nr, nc]:
                done[nr, nc] = True
                z[nr, nc] = max(z[nr, nc], h + 1e-4)
                heapq.heappush(heap, (z[nr, nc], nr, nc))
    return z


def upstream(z, outlet):
    """Cells whose steepest-descent path (D8) reaches the outlet."""
    lat = NORTH - (np.arange(HEIGHT) + 0.5) * DLAT
    dx = (DLNG * 111_320 * np.cos(np.radians(lat)))[:, None]
    dy = DLAT * 110_574
    padded = np.pad(z, 1, constant_values=np.inf)
    best = np.zeros(z.shape)
    target = np.arange(z.size).reshape(z.shape)  # each cell drains to itself until a lower neighbour is found
    rows, cols = np.indices(z.shape)
    for dr, dc in NEIGHBOURS:
        drop = (z - padded[1 + dr : 1 + dr + HEIGHT, 1 + dc : 1 + dc + WIDTH]) / np.hypot(dr * dy, dc * dx)
        better = drop > best
        best[better] = drop[better]
        target[better] = ((rows + dr) * WIDTH + cols + dc)[better]
    target = target.ravel()
    target[outlet[0] * WIDTH + outlet[1]] = outlet[0] * WIDTH + outlet[1]
    while True:  # pointer jumping: follow the paths in doubling steps
        jumped = target[target]
        if np.array_equal(jumped, target):
            break
        target = jumped
    return (target == outlet[0] * WIDTH + outlet[1]).reshape(z.shape)


def widen(mask, cells):
    for _ in range(cells):
        padded = np.pad(mask, 1)
        mask = np.logical_or.reduce([padded[1 + dr : 1 + dr + HEIGHT, 1 + dc : 1 + dc + WIDTH] for dr, dc in NEIGHBOURS + [(0, 0)]])
    return mask


def fill_holes(mask):
    outside = np.zeros_like(mask)
    outside[[0, -1], :] = ~mask[[0, -1], :]
    outside[:, [0, -1]] = ~mask[:, [0, -1]]
    while True:
        grown = outside.copy()
        grown[1:] |= outside[:-1]
        grown[:-1] |= outside[1:]
        grown[:, 1:] |= outside[:, :-1]
        grown[:, :-1] |= outside[:, 1:]
        grown &= ~mask
        if np.array_equal(grown, outside):
            return ~outside
        outside = grown


def outline(mask):
    """Largest ring of cell edges around the mask, counter-clockwise, as (lng, lat)."""
    edges = {}
    for r, c in zip(*np.nonzero(mask)):
        inside = lambda rr, cc: 0 <= rr < HEIGHT and 0 <= cc < WIDTH and mask[rr, cc]
        # Corners are (row, col); going clockwise on screen keeps the cell on the right.
        if not inside(r - 1, c):
            edges.setdefault((r, c), []).append((r, c + 1))
        if not inside(r, c + 1):
            edges.setdefault((r, c + 1), []).append((r + 1, c + 1))
        if not inside(r + 1, c):
            edges.setdefault((r + 1, c + 1), []).append((r + 1, c))
        if not inside(r, c - 1):
            edges.setdefault((r + 1, c), []).append((r, c))
    rings = []
    while edges:
        start = next(iter(edges))
        ring, here, heading = [start], start, None
        while True:
            options = edges[here]
            if len(options) > 1 and heading:
                # Where two cells touch at a corner only, turn right: keeps 4-connected pieces apart.
                right = (heading[1], -heading[0])
                options.sort(key=lambda p: (p[0] - here[0], p[1] - here[1]) != right)
            nxt = options.pop(0)
            if not options:
                del edges[here]
            heading = (nxt[0] - here[0], nxt[1] - here[1])
            if nxt == start:
                break
            ring.append(nxt)
            here = nxt
        rings.append(ring)
    ring = max(rings, key=len)
    return [(WEST + c * DLNG, NORTH - r * DLAT) for r, c in ring]


def simplify(points, tolerance):
    """Douglas-Peucker on a closed ring; drops the staircase of cell edges."""
    pts = np.array(points + points[:1])
    keep = np.zeros(len(pts), bool)
    keep[[0, len(pts) // 2, -1]] = True
    stack = [(0, len(pts) // 2), (len(pts) // 2, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        seg = pts[b] - pts[a]
        rel = pts[a + 1 : b] - pts[a]
        dist = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / (np.hypot(*seg) or 1)
        i = int(np.argmax(dist))
        if dist[i] > tolerance:
            keep[a + 1 + i] = True
            stack += [(a, a + 1 + i), (a + 1 + i, b)]
    return [tuple(p) for p in pts[keep]]


def inside(point, ring):
    x, y = point
    hit = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            hit = not hit
    return hit


def area_km2(ring):
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    xy = [(x * 111.32 * math.cos(lat0), y * 110.574) for x, y in ring]
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(xy, xy[1:]))) / 2


def main():
    z = elevation()
    lines = watercourses()
    burn(z, lines)
    mask = fill_holes(widen(upstream(fill(z), cell(*OUTLET)), MARGIN_CELLS))
    assert not (mask[[0, -1], :].any() or mask[:, [0, -1]].any()), "catchment reaches the grid edge: widen the box"

    ring = [(round(x, 6), round(y, 6)) for x, y in simplify(outline(mask), tolerance=DLNG * 0.75)]
    # Self-checks: the whole Saurat lies inside, down to the confluence; Tarascon's centre does not.
    saurat = [p for name, line in lines if name == "le Saurat" for p in line]
    outside = [p for p in saurat if not inside(p, ring)]
    assert not outside, f"Saurat vertices outside the outline: {outside[:5]}"
    assert not inside((1.6036, 42.8456), ring), "Tarascon-sur-Ariège should be outside"

    collection = {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {
                "name": "Bassin versant du Saurat",
                "source": "RGE ALTI (IGN) + BD TOPAGE, en amont du confluent avec l'Ariège",
            },
            "geometry": {"type": "Polygon", "coordinates": [ring]},
        }],
    }
    (DATA / "basin.geojson").write_text(json.dumps(collection, ensure_ascii=False) + "\n", "utf-8")
    print(f"basin.geojson: {len(ring)} points, {area_km2(ring):.1f} km², {len(saurat)} Saurat vertices inside")


if __name__ == "__main__":
    main()
