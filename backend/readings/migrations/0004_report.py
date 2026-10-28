import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('readings', '0003_reading_owner_remove_edit_key'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Report',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='signalé le')),
                ('reading', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reports', to='readings.reading', verbose_name='relevé')),
                ('reporter', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='reports', to=settings.AUTH_USER_MODEL, verbose_name='signalé par')),
            ],
            options={
                'verbose_name': 'signalement',
                'ordering': ['-created_at'],
                'constraints': [models.UniqueConstraint(fields=('reading', 'reporter'), name='one_report_per_account')],
            },
        ),
    ]
