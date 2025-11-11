from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import synth, mfcc, gmm

app = FastAPI(title="Gamasynth API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(synth.router, prefix="/synthesize")
app.include_router(mfcc.router, prefix="/mfcc")
app.include_router(gmm.router, prefix="/gmm")

@app.get("/")
def root():
    return {"message": "Gamasynth API is running."}