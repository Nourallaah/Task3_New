from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.routes import router
import os
from pathlib import Path

app = FastAPI(title="Signal Equalizer API", version="1.0.0")

# إنشاء مجلد output إذا لم يكن موجوداً
BASE_DIR = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

print(f"Output directory created at: {OUTPUT_DIR}")

# Allow CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:5000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files directory for separated audio
app.mount("/separated", StaticFiles(directory=str(OUTPUT_DIR)), name="separated")

app.include_router(router)

@app.get("/")
def read_root():
    return {"message": "Equalizer backend running!"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000)