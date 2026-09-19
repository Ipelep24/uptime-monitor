from rest_framework import generics, viewsets
from rest_framework.permissions import AllowAny

from .models import Monitor
from .serializers import MonitorSerializer, RegisterSerializer


class MonitorViewSet(viewsets.ModelViewSet):
    serializer_class = MonitorSerializer

    def get_queryset(self):
        # users only ever see their own monitors
        return Monitor.objects.filter(owner=self.request.user).order_by("id")

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class RegisterView(generics.CreateAPIView):
    serializer_class = RegisterSerializer
    permission_classes = [AllowAny]