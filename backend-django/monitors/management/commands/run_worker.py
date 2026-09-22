import os
import time

import redis
import requests
from django.core.management.base import BaseCommand
from django.db import IntegrityError, close_old_connections
from django.utils import timezone

from monitors.models import CheckResult, Incident, Monitor

QUEUE = "checks"
FAILURES_BEFORE_INCIDENT = 3

def status_is_expected(status_code, expected: str) -> bool:
    """Checks a status code against a spec like '200-299,401,403'."""
    if status_code is None:
        return False
    for part in expected.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            low, high = part.split("-")
            if int(low) <= status_code <= int(high):
                return True
        elif part.isdigit() and int(part) == status_code:
            return True
    return False

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
        status_code = None
        error = ""

        try:
            resp = requests.get(monitor.url, timeout=10)
            status_code = resp.status_code
            is_up = status_is_expected(resp.status_code, monitor.expected_status)
            if not is_up:
                error = f"HTTP {resp.status_code}"
        except requests.RequestException as e:
            is_up = False
            error = f"{type(e).__name__}: {e}"[:255]

        elapsed = int((time.monotonic() - start) * 1000)

        CheckResult.objects.create(
            monitor=monitor,
            is_up=is_up,
            status_code=status_code,
            response_time_ms=elapsed if status_code is not None else None,
            error=error[:255],
        )

        if is_up:
            self.stdout.write(f"{monitor.name}: {status_code} in {elapsed}ms")
        else:
            self.stdout.write(f"{monitor.name}: DOWN ({error[:80]})")

        self.update_incident(monitor, is_up, error)

    def update_incident(self, monitor, is_up, error):
        open_incident = Incident.objects.filter(
            monitor=monitor, resolved_at__isnull=True
        ).first()

        if is_up:
            if open_incident:
                open_incident.resolved_at = timezone.now()
                open_incident.save(update_fields=["resolved_at"])
                self.stdout.write(f"RESOLVED: {monitor.name} is back up")
            return

        if open_incident:
            return  # already reported, don't open a second one

        recent = list(
            CheckResult.objects.filter(monitor=monitor).order_by("-checked_at")[
                :FAILURES_BEFORE_INCIDENT
            ]
        )
        if len(recent) == FAILURES_BEFORE_INCIDENT and not any(
            c.is_up for c in recent
        ):
            try:
                Incident.objects.create(monitor=monitor, reason=error[:255])
                self.stdout.write(f"INCIDENT OPENED: {monitor.name} ({error[:80]})")
            except IntegrityError:
                pass  # another worker opened it first