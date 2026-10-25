@echo off
chcp 65001 >nul
title Eaux de Saurat - arrêt
cd /d "%~dp0.."

echo.
echo  Arrêt du site Eaux de Saurat...
echo.
docker compose down
if errorlevel 1 (
  echo.
  echo  [!] Le site n'a pas pu être arrêté. Vérifiez que Docker Desktop est ouvert.
) else (
  echo.
  echo  Le site est arrêté. Vos essais sont gardés pour la prochaine fois.
)

echo.
echo  Vous pouvez fermer cette fenêtre.
pause >nul
