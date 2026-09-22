from django.contrib import admin
from .models import CheckResult, Incident, Monitor
# Register your models here.

@admin.register(Monitor)
class MonitorAdmin(admin.ModelAdmin):
    list_display = ("name", "url", "expected_status", "interval_seconds", "is_active", "owner")

@admin.register(CheckResult)
class CheckResultAdmin(admin.ModelAdmin):
    list_display = ("monitor", "is_up", "status_code", "response_time_ms", "checked_at")
    list_filter = ("is_up",)
@admin.register(Incident)
class IncidentAdmin(admin.ModelAdmin):
    list_display = ("monitor", "started_at", "resolved_at", "reason")