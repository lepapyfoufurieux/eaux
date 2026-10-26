@echo off
chcp 65001 >nul
title Eaux de Saurat - démarrage
cd /d "%~dp0.."

echo.
echo  Démarrage du site Eaux de Saurat
echo  ================================
echo.

docker info >nul 2>&1
if errorlevel 1 (
  echo  [!] Docker Desktop n'est pas démarré.
  echo      Ouvrez Docker Desktop, attendez "Engine running", puis relancez ce fichier.
  goto fin
)

if not exist .env copy .env.example .env >nul
rem Django refuses the placeholder key: give this computer its own (also fixes a .env made before this rule).
powershell -NoProfile -Command "$k = -join ((1..48) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }); (Get-Content .env) -replace '^DJANGO_SECRET_KEY=change-me$', ('DJANGO_SECRET_KEY=' + $k) | Set-Content -Encoding ascii .env"

echo  Préparation du site. La première fois, cela peut prendre 5 à 15 minutes.
echo  Beaucoup de texte va défiler : c'est normal, laissez faire.
echo.
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo  [!] Le site n'a pas pu démarrer. Consultez la rubrique "Un problème ?" du guide.
  goto fin
)

echo.
echo  Presque fini, le site s'installe...
set essais=0
:attente
docker compose exec -T backend python manage.py migrate --check >nul 2>&1
if not errorlevel 1 goto pret
set /a essais+=1
if %essais% geq 60 (
  echo  [!] Le site met trop de temps à démarrer. Consultez la rubrique "Un problème ?" du guide.
  goto fin
)
timeout /t 3 /nobreak >nul
goto attente

:pret
rem seed_demo refuses a database that already holds data, which is expected after the first start.
docker compose exec -T backend python manage.py seed_demo >nul 2>&1

echo  Fond de carte : la première fois, son téléchargement prend quelques minutes.
rem Tiles already downloaded are skipped. A failure is not fatal: the map then takes them from the IGN.
docker compose exec -T backend python /data/download_tiles.py 2>nul

echo.
echo  C'est prêt ! Le site s'ouvre dans votre navigateur : https://localhost
start "" https://localhost

:fin
echo.
echo  Vous pouvez fermer cette fenêtre.
pause >nul
