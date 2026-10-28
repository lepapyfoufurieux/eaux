import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('readings', '0002_remove_station_reference_reading'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveField(
            model_name='reading',
            name='edit_key_hash',
        ),
        migrations.AddField(
            model_name='reading',
            name='owner',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='readings', to=settings.AUTH_USER_MODEL, verbose_name='compte'),
        ),
    ]
