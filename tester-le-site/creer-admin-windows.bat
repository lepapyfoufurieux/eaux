@echo off
chcp 65001 >nul
title Eaux de Saurat - compte administrateur
cd /d "%~dp0.."

echo.
echo  Création d'un compte administrateur
echo  Le mot de passe ne s'affiche pas pendant que vous le tapez : c'est normal.
echo.
docker compose exec backend python manage.py createsuperuser
if not errorlevel 1 (
  echo.
  echo  Compte créé. Connectez-vous sur https://localhost/admin
  start "" https://localhost/admin
)

echo.
echo  Vous pouvez fermer cette fenêtre.
pause >nul
