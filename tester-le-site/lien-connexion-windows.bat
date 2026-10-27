@echo off
chcp 65001 >nul
title Eaux de Saurat - lien de connexion
cd /d "%~dp0.."

echo.
echo  Sur cet ordinateur, le site n'envoie pas d'e-mail : ce fichier ouvre le lien de connexion à sa place.
echo.
set /p email= Votre adresse e-mail : 
set link=
for /f "delims=" %%l in (
'docker compose exec -T backend python manage.py sign_in_link "%email%"'
) do set link=%%l
if defined link (
  start "" "https://localhost%link%"
  echo  Le lien de connexion s'ouvre dans votre navigateur.
) else (
  echo  Le lien n'a pas pu être créé : vérifiez l'adresse, et que le site est démarré.
)

echo.
echo  Vous pouvez fermer cette fenêtre.
pause >nul
