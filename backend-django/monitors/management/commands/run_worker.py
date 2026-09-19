import os
import time

import redis
import requests
from django.core.management.base import BaseCommand
from django.db import close_old_connections

from monitors.models import CheckResult, Monitor

QUEUE = "checks"


def make_redis():
    return redis.Redis.from_url(
        os.environ["REDIS_URL"],
        socket_timeout=15,  # must be longer than the 5s blocking wait below
        socket_connect_timeout=5,
        socket_keepalive=True,
        health_check_interval=30,
    )


class Command(BaseCommand):
    help = "Take check jobs from Redis and run them"

    def handle(self, *args, **options):
        r = make_redis()
        self.stdout.write("Worker started")

        while True:
            try:
                job = r.brpop(QUEUE, timeout=5)  # waits up to 5s for a job
            except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError) as e:
                self.stdout.write(f"Redis problem ({type(e).__name__}), retrying...")
                time.sleep(2)
                continue

            if job is None:
                continue

            close_old_connections()
            try:
                monitor = Monitor.objects.get(id=int(job[1]))
            except Monitor.DoesNotExist:
                continue

            self.check_monitor(monitor)

    def check_monitor(self, monitor):
        start = time.monotonic()
        try:
            resp = requests.get(monitor.url, timeout=10)
            elapsed = int((time.monotonic() - start) * 1000)
            CheckResult.objects.create(
                monitor=monitor,
                is_up=resp.status_code < 400,
                status_code=resp.status_code,
                response_time_ms=elapsed,
            )
            self.stdout.write(f"{monitor.name}: {resp.status_code} in {elapsed}ms")
        except requests.RequestException as e:
            CheckResult.objects.create(
                monitor=monitor,
                is_up=False,
                error=str(e)[:255],
            )
            self.stdout.write(f"{monitor.name}: DOWN ({type(e).__name__})")