#!/bin/sh
cd "$(dirname "$0")/.." || exit 1

echo
echo " Sur cet ordinateur, le site n'envoie pas d'e-mail : ce fichier ouvre le lien de connexion à sa place."
echo
printf " Votre adresse e-mail : "
read -r email
if link=$(docker compose exec -T backend python manage.py sign_in_link "$email"); then
  echo " Le lien de connexion s'ouvre dans votre navigateur."
  open "https://localhost$link"
else
  echo " Le lien n'a pas pu être créé : vérifiez l'adresse, et que le site est démarré."
fi
