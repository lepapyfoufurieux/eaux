# Reference data

Raw downloads go in `data/raw/` (ignored by git). Prepared files are GeoJSON in EPSG:4326 and are loaded with:

```sh
cd backend
python manage.py import_geodata \
  --basin ../data/basin.geojson \
  --watercourses ../data/watercourses.geojson \
  --springs ../data/springs.geojson
```

| File | Source | Expected properties |
| --- | --- | --- |
| `basin.geojson` | Topographic catchment of Le Saurat, computed by `prepare_basin.py` (see below) | `name` |
| `watercourses.geojson` | BD TOPAGE watercourses clipped to the basin, written by `prepare_layers.py` | `name`, `code` |
| `springs.geojson` | BD TOPO springs (IGN) and BD TOPAGE source nodes (OFB) inside the basin, written by `prepare_layers.py` | `kind`, `altitude_m`, `origin` (`ign` or `ofb`) |

## The catchment outline

Photos taken outside `basin.geojson` are refused, so it must hold the whole valley and nothing more. BD TOPAGE has no catchment for the Saurat alone: its smallest one, zone O122, also covers the Ariège valley from Tarascon to Arnave. So `basin.geojson` is computed from the IGN elevation model (RGE ALTI) with the BD TOPAGE watercourses burnt into it: every cell that drains into the Saurat's confluence with the Ariège in Tarascon, widened by about 30 m for phone GPS error (56 km²).

```sh
python data/prepare_basin.py    # needs numpy and access to data.geopf.fr; caches downloads in data/raw/
```

The script stops if the outline misses part of the Saurat or takes in Tarascon. `backend/geo/tests/test_basin.py` checks the committed file the same way after import.

## Updating everything

`python data/update_data.py` clears `data/raw/`, runs `prepare_basin.py`, `prepare_layers.py` and `download_tiles.py`, loads the result into the running Docker site, then lists the changed files to review and commit. Without Python, `tester-le-site/mettre-a-jour-donnees-*` do the same in a container.

## Map tiles

The map shows only the valley and its surroundings, from a local copy of the Plan IGN tiles (Licence Ouverte, credited "© IGN"):

```sh
python data/download_tiles.py   # zooms 11 to 17, about 5,000 tiles and 85 MB in data/tiles/ (ignored by git); run again to resume
```

In the Docker stack: `docker compose exec backend python /data/download_tiles.py` (the testers' start scripts run it). Tiles already on disk are never downloaded again. Caddy serves them at `/tiles/` (Django does in development). A tile missing there is fetched from the Géoplateforme, so the map also works before the download.

## After the import

Set each tributary's `tributary_of` and `confluence_position` in the admin, then create the stations (code S01…, watercourse, order from upstream). The river plan view is drawn from those fields.

For development, `python manage.py seed_demo` imports these files and adds fictitious stations along the real watercourses, with readings at them and at a few named springs.
