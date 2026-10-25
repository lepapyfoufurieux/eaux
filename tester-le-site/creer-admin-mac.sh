#!/bin/sh
cd "$(dirname "$0")/.." || exit 1

echo
echo " Création d'un compte administrateur"
echo " Le mot de passe ne s'affiche pas pendant que vous le tapez : c'est normal."
echo
if docker compose exec backend python manage.py createsuperuser; then
  echo
  echo " Compte créé. Connectez-vous sur https://localhost/admin"
  open https://localhost/admin
fi
