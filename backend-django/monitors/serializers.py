from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import Monitor

User = get_user_model()


class MonitorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Monitor
        fields = ["id", "name", "url", "expected_status", "interval_seconds", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_interval_seconds(self, value):
        if value < 30:
            raise serializers.ValidationError("Minimum interval is 30 seconds.")
        return value


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["id", "username", "password"]

    def create(self, validated_data):
        return User.objects.create_user(**validated_data)