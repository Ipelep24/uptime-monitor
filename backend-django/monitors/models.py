from django.conf import settings
from django.db import models

# Create your models here.
class Monitor(models.Model):
    owner = models. ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="monitors",
    )

    name = models.CharField(max_length=100)
    url = models.URLField()
    interval_seconds = models.PositiveIntegerField(default=60)
    is_active = models.BooleanField(default=True)
    create_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.url})"

class CheckResult(models.Model):
    monitor = models.ForeignKey(
        Monitor,
        on_delete=models.CASCADE,
        related_name="results"
    )

    is_up = models.BooleanField()
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    response_time_ms = models.PositiveIntegerField(null=True, blank=True)
    error = models.CharField(max_length=255, blank=True)
    checked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-checked_at"]
        indexes = [
            models.Index(fields=["monitor", "-checked_at"]),
        ]

    def __str__(self):
        return f"{self.monitor.name}: {'up' if self.is_up else 'down'} at {self.checked_at}"