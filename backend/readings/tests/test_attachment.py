from django.contrib.gis.geos import Point

from readings.attachment import nearest_station


def test_attaches_to_nearest_station_within_radius(stations):
    # About 120 m east of Pont de Loumet
    station, distance = nearest_station(Point(1.4905, 42.8790, srid=4326))
    assert station == stations["loumet"]
    assert 100 < distance < 140


def test_no_station_beyond_radius(stations):
    # Halfway between the two stations, about 1.5 km from each
    station, distance = nearest_station(Point(1.5075, 42.8745, srid=4326))
    assert station is None and distance is None


def test_inactive_station_is_ignored(stations):
    stations["loumet"].active = False
    stations["loumet"].save()
    station, _ = nearest_station(Point(1.4891, 42.8790, srid=4326))
    assert station is None
