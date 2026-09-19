from django.contrib import admin
from .models import CheckResult, Monitor
# Register your models here.

@admin.register(Monitor)
class MonitorAdmin(admin.ModelAdmin):
    list_display = ("name", "url", "interval_seconds", "is_active", "owner")

@admin.register(CheckResult)
class CheckResultAdmin(admin.ModelAdmin):
    list_display = ("monitor", "is_up", "status_code", "response_time_ms", "checked_at")
    list_filter = ("is_up",)