from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import get_settings

settings = get_settings()

client = AsyncIOMotorClient(settings.mongodb_uri)
db = client[settings.mongodb_db]
