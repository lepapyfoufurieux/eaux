#!/bin/sh
# Launched with "sh demarrer-mac.sh" from Terminal, so it needs no execute bit and passes Gatekeeper.
cd "$(dirname "$0")/.." || exit 1

echo
echo " Démarrage du site Eaux de Saurat"
echo " ================================"
echo

if ! docker info >/dev/null 2>&1; then
  echo " [!] Docker Desktop n'est pas démarré."
  echo "     Ouvrez Docker Desktop, attendez \"Engine running\", puis relancez cette commande."
  exit 1
fi

[ -f .env ] || cp .env.example .env

echo " Préparation du site. La première fois, cela peut prendre 5 à 15 minutes."
echo " Beaucoup de texte va défiler : c'est normal, laissez faire."
echo
if ! docker compose up -d --build; then
  echo
  echo " [!] Le site n'a pas pu démarrer. Consultez la rubrique \"Un problème ?\" du guide."
  exit 1
fi

echo
echo " Presque fini, le site s'installe..."
essais=0
until docker compose exec -T backend python manage.py migrate --check >/dev/null 2>&1; do
  essais=$((essais + 1))
  if [ "$essais" -ge 60 ]; then
    echo " [!] Le site met trop de temps à démarrer. Consultez la rubrique \"Un problème ?\" du guide."
    exit 1
  fi
  sleep 3
done

# seed_demo refuses a database that already holds data, which is expected after the first start.
docker compose exec -T backend python manage.py seed_demo >/dev/null 2>&1

echo " Fond de carte : la première fois, son téléchargement prend quelques minutes."
# Tiles already downloaded are skipped. A failure is not fatal: the map then takes them from the IGN.
docker compose exec -T backend python /data/download_tiles.py >/dev/null 2>&1

echo
echo " C'est prêt ! Le site s'ouvre dans votre navigateur : https://localhost"
open https://localhost
