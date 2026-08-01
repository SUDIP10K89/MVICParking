from fastapi import FastAPI
from app.routers.health import router as health_router

app = FastAPI(title="Smart Parking Management System")
app.include_router(health_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Smart Parking API"}
