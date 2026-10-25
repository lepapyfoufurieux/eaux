@echo off
chcp 65001 >nul
title Eaux de Saurat - mise à jour des données
cd /d "%~dp0.."

echo.
echo  Mise à jour des données IGN (bassin, cours d'eau, sources, fond de carte)
echo  =======================================================================
echo.

docker info >nul 2>&1
if errorlevel 1 (
  echo  [!] Docker Desktop n'est pas démarré.
  echo      Ouvrez Docker Desktop, attendez "Engine running", puis relancez ce fichier.
  goto fin
)

echo  Téléchargement et préparation : quelques minutes.
echo.
rem Python and numpy come in a throwaway container, so nothing needs installing on this computer.
docker run --rm -v "%cd%\data:/data" -w /data python:3.12-slim sh -c "pip install -q --root-user-action=ignore --disable-pip-version-check numpy && python update_data.py"
if errorlevel 1 (
  echo.
  echo  [!] La mise à jour a échoué ^(pas d'internet ?^). Les anciennes données sont gardées dans le site.
  goto fin
)

echo.
echo  Chargement dans le site...
docker compose exec -T backend python manage.py import_geodata --basin /data/basin.geojson --watercourses /data/watercourses.geojson --springs /data/springs.geojson
if errorlevel 1 (
  echo.
  echo  [!] Le site n'est pas démarré : lancez demarrer-windows, puis relancez ce fichier.
  goto fin
)
echo.
echo  C'est fait ! Rechargez la page du site.

:fin
echo.
echo  Vous pouvez fermer cette fenêtre.
pause >nul
