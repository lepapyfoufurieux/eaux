from ninja import NinjaAPI

from accounts.api import router as accounts_router
from geo.api import router as geo_router
from readings.api import router as readings_router

api = NinjaAPI(title="Eaux de Saurat", version="1")
api.add_router("/", readings_router)
api.add_router("/", accounts_router)
api.add_router("/geo", geo_router)
