"""Download the Plan IGN tiles of the Saurat valley into data/tiles/{z}/{x}/{y}.png.

The map serves them from /tiles and falls back to the Géoplateforme for any tile missing here.
Plan IGN is under the Licence Ouverte: keeping a copy is allowed, with the "© IGN" credit.
Tiles already on disk are never downloaded again, so running it at every start costs a few seconds.

    python data/download_tiles.py       # about 5,000 tiles, 85 MB; run again to resume
    docker compose exec -T backend python /data/download_tiles.py     # the same, in the Docker stack
"""

import math
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# The box of prepare_basin.py, repeated so this script runs without numpy (in the backend container).
SOUTH, WEST, NORTH, EAST = 42.83, 1.43, 42.93, 1.63
TILES = Path(__file__).parent / "tiles"
# Must match MAX_LOCAL_ZOOM in frontend/src/views/map/map.ts; above it the map enlarges zoom 17.
ZOOMS = range(11, 18)
URL = (
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2"
    "&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
)


def tile(lat, lng, z):
    n = 2**z
    x = int((lng + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return x, y


def tiles():
    for z in ZOOMS:
        x0, y0 = tile(NORTH, WEST, z)
        x1, y1 = tile(SOUTH, EAST, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                yield z, x, y


def fetch(zxy):
    z, x, y = zxy
    path = TILES / str(z) / str(x) / f"{y}.png"
    if path.exists():
        return 0
    # The Géoplateforme sometimes answers a valid tile with a passing error: try again a little later.
    for attempt in range(5):
        try:
            with urllib.request.urlopen(URL.format(z=z, x=x, y=y), timeout=60) as response:
                body = response.read()
            if not body.startswith(b"\x89PNG"):
                raise ValueError("not a PNG")
            path.parent.mkdir(parents=True, exist_ok=True)
            # Write then rename, so an interrupted run never leaves a half tile that the next run would skip.
            part = path.with_suffix(".part")
            part.write_bytes(body)
            part.replace(path)
            return 1
        except Exception:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"tile {z}/{x}/{y} failed 5 times")


def progress(i, total):
    """One line redrawn in place, read by the testers in their start window."""
    filled = 30 * i // total
    print(f"\r   [{'█' * filled}{'░' * (30 - filled)}] {100 * i // total:3d} %  ({i} / {total} tuiles)", end="", flush=True)


def main():
    todo = [t for t in tiles() if not (TILES / str(t[0]) / str(t[1]) / f"{t[2]}.png").exists()]
    if not todo:
        print("   Fond de carte déjà téléchargé.")
        return
    progress(0, len(todo))
    # A few parallel requests: fast enough, and polite to a free public service.
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, _ in enumerate(pool.map(fetch, todo), start=1):
            if 100 * i // len(todo) != 100 * (i - 1) // len(todo):
                progress(i, len(todo))
    size = sum(p.stat().st_size for p in TILES.rglob("*.png"))
    print(f"\n   Fond de carte téléchargé ({size / 1e6:.0f} Mo).")


if __name__ == "__main__":
    main()
