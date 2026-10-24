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
| `basin.geojson` | BD TOPAGE, topographic catchment of Le Saurat (IGN / OFB) | `name` |
| `watercourses.geojson` | BD TOPAGE watercourses clipped to the basin | `name`, `code` |
| `springs.geojson` | IGN BD TOPO and OFB springs inside the basin | `kind`, `altitude_m`, `origin` (`ign` or `ofb`) |

After the import, set each tributary's `tributary_of` and `confluence_position` in the admin, then create the stations (code S01…, watercourse, order from upstream). The river plan view is drawn from those fields.

For development without real data, `python manage.py seed_demo` loads the mockup's fictitious stations and readings.
