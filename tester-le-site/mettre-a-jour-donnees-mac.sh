#!/bin/sh
cd "$(dirname "$0")/.." || exit 1

echo
echo " Mise à jour des données IGN (bassin, cours d'eau, sources, fond de carte)"
echo " ======================================================================="
echo

if ! docker info >/dev/null 2>&1; then
  echo " [!] Docker Desktop n'est pas démarré."
  echo "     Ouvrez Docker Desktop, attendez \"Engine running\", puis relancez ce fichier."
  exit 1
fi

echo " Téléchargement et préparation : quelques minutes."
echo
# Python and numpy come in a throwaway container, so nothing needs installing on this computer.
if ! docker run --rm -v "$PWD/data:/data" -w /data python:3.12-slim \
  sh -c "pip install -q --root-user-action=ignore --disable-pip-version-check numpy && python update_data.py"; then
  echo
  echo " [!] La mise à jour a échoué (pas d'internet ?). Les anciennes données sont gardées dans le site."
  exit 1
fi

echo
echo " Chargement dans le site..."
if docker compose exec -T backend python manage.py import_geodata \
  --basin /data/basin.geojson --watercourses /data/watercourses.geojson --springs /data/springs.geojson; then
  echo
  echo " C'est fait ! Rechargez la page du site."
else
  echo
  echo " [!] Le site n'est pas démarré : lancez demarrer-mac.sh, puis relancez ce fichier."
fi
