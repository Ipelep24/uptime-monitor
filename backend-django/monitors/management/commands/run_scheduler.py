import os
import time

import redis
from django.core.management.base import BaseCommand
from django.db import close_old_connections

from monitors.models import Monitor

QUEUE = "checks"


def make_redis():
    return redis.Redis.from_url(
        os.environ["REDIS_URL"],
        socket_timeout=15,
        socket_connect_timeout=5,
        socket_keepalive=True,
        health_check_interval=30,
    )


class Command(BaseCommand):
    help = "Put due monitors into the Redis queue"

    def handle(self, *args, **options):
        r = make_redis()
        self.stdout.write("Scheduler started")

        while True:
            try:
                close_old_connections()
                for monitor in Monitor.objects.filter(is_active=True):
                    key = f"monitor:{monitor.id}:scheduled"
                    # Only succeeds if the key doesn't exist yet. The key
                    # expires after the interval, so the monitor becomes due again.
                    if r.set(key, 1, nx=True, ex=monitor.interval_seconds):
                        r.lpush(QUEUE, monitor.id)
                        self.stdout.write(f"Queued {monitor.name}")
            except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError) as e:
                self.stdout.write(f"Redis problem ({type(e).__name__}), retrying...")
            time.sleep(5)