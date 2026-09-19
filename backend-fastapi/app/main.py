import json
import os

import psycopg
import redis
from fastapi import FastAPI, HTTPException
from psycopg.rows import dict_row
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Uptime Monitor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DATABASE_URL = os.getenv("DATABASE_URL", "")
REDIS_URL = os.getenv("REDIS_URL", "")

cache = redis.Redis.from_url(
    REDIS_URL, socket_timeout=5, socket_connect_timeout=3
)


def query(sql, params=()):
    with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
        return conn.execute(sql, params).fetchall()


def to_json_safe(rows):
    # converts datetimes and other non-JSON types to strings
    return json.loads(json.dumps(rows, default=str))


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
where m.is_active
order by m.id
"""


@app.get("/status")
def status_all():
    """Latest status of every active monitor, cached in Redis for 10 seconds."""
    try:
        cached = cache.get("status:all")
        if cached:
            return json.loads(cached)
    except redis.RedisError:
        pass  # if Redis is down, just skip the cache

    data = to_json_safe(query(STATUS_SQL))

    try:
        cache.set("status:all", json.dumps(data), ex=10)
    except redis.RedisError:
        pass

    return data


@app.get("/monitors/{monitor_id}/results")
def monitor_results(monitor_id: int, limit: int = 20):
    """Most recent check results for one monitor."""
    limit = max(1, min(limit, 200))

    monitor = query(
        "select id, name, url from monitors_monitor where id = %s", (monitor_id,)
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