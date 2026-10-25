#!/bin/sh
cd "$(dirname "$0")/.." || exit 1

echo
echo " Arrêt du site Eaux de Saurat..."
echo
if docker compose down; then
  echo
  echo " Le site est arrêté. Vos essais sont gardés pour la prochaine fois."
else
  echo
  echo " [!] Le site n'a pas pu être arrêté. Vérifiez que Docker Desktop est ouvert."
fi
