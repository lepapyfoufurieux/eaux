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
| `watercourses.geojson` | BD TOPAGE watercourses clipped to the basin | `name`, `code` |
| `springs.geojson` | IGN BD TOPO and OFB springs inside the basin | `kind`, `altitude_m`, `origin` (`ign` or `ofb`) |

## The catchment outline

Photos taken outside `basin.geojson` are refused, so it must hold the whole valley and nothing more. BD TOPAGE has no catchment for the Saurat alone: its smallest one, zone O122, also covers the Ariège valley from Tarascon to Arnave. So `basin.geojson` is computed from the IGN elevation model (RGE ALTI) with the BD TOPAGE watercourses burnt into it: every cell that drains into the Saurat's confluence with the Ariège in Tarascon, widened by about 30 m for phone GPS error (56 km²).

```sh
python data/prepare_basin.py    # needs numpy and access to data.geopf.fr; caches downloads in data/raw/
```

The script stops if the outline misses part of the Saurat or takes in Tarascon. `backend/geo/tests/test_basin.py` checks the committed file the same way after import.

## After the import

Set each tributary's `tributary_of` and `confluence_position` in the admin, then create the stations (code S01…, watercourse, order from upstream). The river plan view is drawn from those fields.

For development without real data, `python manage.py seed_demo` loads the mockup's fictitious stations and readings.
