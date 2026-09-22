import json
import os

import jwt
import psycopg
import redis
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
import asyncio

from fastapi.responses import StreamingResponse

app = FastAPI(title="Uptime Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL", "")
REDIS_URL = os.getenv("REDIS_URL", "")
JWT_SECRET = os.getenv("JWT_SECRET", "")

cache = redis.Redis.from_url(
    REDIS_URL, socket_timeout=5, socket_connect_timeout=3
)


def query(sql, params=()):
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        return conn.execute(sql, params).fetchall()


def to_json_safe(rows):
    # converts datetimes and other non-JSON types to strings
    return json.loads(json.dumps(rows, default=str))

def current_user_id(
    authorization: str | None = Header(default=None), token: str | None = None
) -> int:
    """Reads the Bearer token (header or ?token= query param) and returns the user's id."""
    raw_token = None
    if authorization and authorization.startswith("Bearer "):
        raw_token = authorization.removeprefix("Bearer ")
    elif token:
        raw_token = token

    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    try:
        payload = jwt.decode(raw_token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if payload.get("token_type") != "access":
        raise HTTPException(status_code=401, detail="Wrong token type")

    return int(payload["user_id"])

@app.get("/health")
def health():
    status = {"postgres": "down", "redis": "down"}

    try:
        with psycopg.connect(DATABASE_URL, connect_timeout=3) as conn:
            conn.execute("select 1")
        status["postgres"] = "up"
    except Exception as e:
        status["postgres_error"] = repr(e)

    try:
        cache.ping()
        status["redis"] = "up"
    except Exception as e:
        status["redis_error"] = repr(e)

    return status


STATUS_SQL = """
select
    m.id, m.name, m.url,
    latest.is_up, latest.status_code, latest.response_time_ms, latest.checked_at,
    stats.uptime_pct, stats.avg_response_ms
from monitors_monitor m
left join lateral (
    select is_up, status_code, response_time_ms, checked_at
    from monitors_checkresult
    where monitor_id = m.id
    order by checked_at desc
    limit 1
) latest on true
left join lateral (
    select
        round(100.0 * avg(case when is_up then 1 else 0 end), 2)::float as uptime_pct,
        round(avg(response_time_ms))::float as avg_response_ms
    from monitors_checkresult
    where monitor_id = m.id and checked_at > now() - interval '24 hours'
) stats on true
where m.is_active and m.owner_id = %s
order by m.id
"""


@app.get("/status")
def status_all(user_id: int = Depends(current_user_id)):
    """Latest status of the logged-in user's monitors, cached briefly in Redis."""
    key = f"status:{user_id}"

    try:
        cached = cache.get(key)
        if cached:
            return json.loads(cached)
    except redis.RedisError:
        pass  # if Redis is down, just skip the cache

    data = to_json_safe(query(STATUS_SQL, (user_id,)))

    try:
        cache.set(key, json.dumps(data), ex=3)
    except redis.RedisError:
        pass

    return data


@app.get("/monitors/{monitor_id}/results")
def monitor_results(
    monitor_id: int, limit: int = 20, user_id: int = Depends(current_user_id)
):
    """Most recent check results for one of the user's monitors."""
    limit = max(1, min(limit, 200))

    monitor = query(
        "select id, name, url from monitors_monitor where id = %s and owner_id = %s",
        (monitor_id, user_id),
    )
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")

    results = query(
        """
        select is_up, status_code, response_time_ms, error, checked_at
        from monitors_checkresult
        where monitor_id = %s
        order by checked_at desc
        limit %s
        """,
        (monitor_id, limit),
    )
    return {"monitor": to_json_safe(monitor)[0], "results": to_json_safe(results)}

@app.get("/stream")
async def stream(user_id: int = Depends(current_user_id)):
    async def event_source():
        pubsub = cache.pubsub()
        pubsub.subscribe(f"updates:{user_id}")
        try:
            while True:
                message = pubsub.get_message(timeout=15)
                if message and message["type"] == "message":
                    data = message["data"]
                    if isinstance(data, bytes):
                        data = data.decode()
                    yield f"data: {data}\n\n"
                else:
                    yield ": keepalive\n\n"  # keeps the connection from timing out
                await asyncio.sleep(0.5)
        finally:
            pubsub.close()

    return StreamingResponse(event_source(), media_type="text/event-stream")