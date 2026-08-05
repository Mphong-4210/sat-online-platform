# SAT Online Platform — Microservices Architecture Lab

End-to-end microservices platform for online SAT preparation, practice testing, and automated grading — covering both standard and advanced requirements of the course.

Client (Postman / Web) │ JWT / Key-auth ▼ Kong Gateway ──────────────► exam-service ◄──► PostgreSQL (jwt, rate-limit, cors) │ ▲ publish │ │ consume (status events) ▼ │ RabbitMQ ─────────┘ │ consume ▼ partner-mock-service │ REST (Partner API integration, │ evaluation & sync)

## Components

| Component | Port | Role |
|---|---|---|
| `exam-service` | 3002 | Core business API: exams management, submissions, Postgres + Redis cache + RabbitMQ producer |
| `partner-mock-service` | 3003 | Partner integration mock: evaluates submissions, syncs evaluation callbacks |
| Kong Gateway (DB-less) | 8000 / 8001 | Edge gateway: route forwarding, rate limiting, security plugins, Prometheus metrics |
| PostgreSQL 16 | 5432 | Primary relational database for exams and user states |
| Redis 7 | 6379 | In-memory cache layer for accelerating exam list queries |
| RabbitMQ 3 | 5672 / 15672 | Message broker for asynchronous submission grading queues (`exam_submissions`) |
| Prometheus | 9090 | Metrics collection scraping `/metrics` endpoint from services |

## Quick start (Docker Compose)

Prerequisites: Docker + Docker Compose, `curl`.

```bash
# Build and start all microservices
docker compose up -d --build
Test endpoints manually via Kong Gateway (Port 8000):
Bash
# 1. Check system health
curl -s http://localhost:8000/health | jq

# 2. Get exams list (cached via Redis / fetched from Postgres)
curl -s http://localhost:8000/api/exams | jq

# 3. Submit an exam (triggers partner integration + RabbitMQ queue)
curl -s -X POST http://localhost:8000/api/submit-exam \
  -H "Content-Type: application/json" \
  -d '{"studentId": "std_123", "answers": {"q1": "A", "q2": "C"}}' | jq
Explore:
•	OpenAPI Documentation: Check docs/openapi.yaml for complete specs.
•	Prometheus Metrics: http://localhost:3002/metrics (or routed via Kong).
Repository layout
docs/            openapi.yaml, architecture notes, review checklist
services/
  exam-service/  Node.js / Express core business microservice
  partner-mock/  Partner mock service for grading & evaluation
infra/           Docker compose configurations, Kong declarative config (kong.yml)
.github/workflows/ CI/CD automated validation and testing pipelines
