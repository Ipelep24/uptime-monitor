import os

import psycopg
import redis
from fastapi import FastAPI

app = FastAPI(title="Uptime Monitor API")

DB_URL = os.getenv("DATABASE_URL", "")
REDIS_URL = os.getenv("REDIS_URL", "")

@app.get("/health")
def health():
    status = {"postgres": "down", "redis": "down"}

    try:
        with psycopg.connect(DB_URL, connect_timeout=3) as conn:
            conn.execute("select 1")
        status["postgres"] = "up"
    except Exception:
        pass

    try: 
        redis.Redis.from_url(REDIS_URL, socket_connect_timeout=3).ping()    
        status["redis"] = "up"
    except Exception:
        pass

    return status
    