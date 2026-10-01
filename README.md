# Uptime Monitor

A self-hosted uptime and status monitoring platform. Users add URLs to watch,
and the system checks them on a schedule, records results, tracks incidents,
and sends alerts when something goes down.

Built as a learning project to practice running a multi-service backend
system end to end: authentication, background job processing, real-time
updates, and containerized deployment.

## Features

- **User accounts** — JWT-based login, each user's monitors are isolated
- **Flexible health checks** — configurable expected status codes (e.g. `200-299,401`) and optional keyword matching against the response body
- **Scheduled checks** — a Redis-backed job queue runs checks on a per-monitor interval, processed by one or more background workers
- **Incident tracking** — opens an incident after 3 consecutive failures, resolves it automatically on recovery
- **Notifications** — Discord webhook and email alerts when a monitor goes down or recovers
- **Real-time dashboard** — live updates via Server-Sent Events (Redis pub/sub under the hood), not just polling
- **Dashboard** — search, add, edit, and delete monitors; response-time chart across all monitors

## Architecture

Next.js (dashboard) ──► FastAPI (status, results, auth check, SSE stream)
│
├── Postgres (users, monitors, check results, incidents)
└── Redis (job queue, cache, pub/sub for live updates)

Django (auth, monitors CRUD, admin) ──► same Postgres

Scheduler ──► pushes due monitor IDs into Redis queue
Worker(s) ──► pulls jobs, performs the HTTP check, saves result, opens/resolves incidents, sends alerts


Everything runs in Docker Compose for local development. Django handles
authentication and monitor management (CRUD, admin panel); FastAPI serves
the high-read-traffic endpoints (status, history, live stream) and shares
the same Postgres database.

## Tech stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS, Recharts
- **Backend:** Django + Django REST Framework, FastAPI
- **Data:** PostgreSQL, Redis (queue, cache, pub/sub)
- **Auth:** JWT (djangorestframework-simplejwt), verified independently in FastAPI
- **Infra:** Docker, Docker Compose (Kubernetes manifests in progress)

## Running locally

```bash
cp .env.example .env   # fill in your own secrets
docker compose up -d --build
```

- Dashboard: http://localhost:3000
- Django admin: http://localhost:8001/admin
- FastAPI docs: http://localhost:8000/docs

## Status

Actively being developed. Current focus: deploying the full stack to
Kubernetes (via Minikube) with a CI/CD pipeline.