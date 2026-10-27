from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email

from accounts.api import sign_in_path


class Command(BaseCommand):
    help = "Print the path of a sign-in link, for computers that send no e-mail (testers): open it after the site's address."

    def add_arguments(self, parser):
        parser.add_argument("email")

    def handle(self, email, **options):
        email = email.strip().lower()
        try:
            validate_email(email)
        except ValidationError:
            raise CommandError("Cette adresse e-mail n'est pas valide.")
        self.stdout.write(sign_in_path(email))
