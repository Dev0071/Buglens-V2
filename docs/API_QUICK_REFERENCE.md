# Buglens API Quick Reference

Fast lookup guide for all API endpoints.

## 🔗 Quick Links

| Resource                          | Base Path           | Description              |
| --------------------------------- | ------------------- | ------------------------ |
| [Authentication](#authentication) | `/api/auth`         | User authentication      |
| [Events](#events)                 | `/api/events`       | Error events             |
| [RCA](#rca)                       | `/api/rca`          | Root cause analysis      |
| [Dashboard](#dashboard)           | `/api/dashboard`    | Statistics               |
| [Integrations](#integrations)     | `/api/integrations` | Third-party integrations |
| [Settings](#settings)             | `/api/settings`     | Organization config      |
| [Costs](#costs)                   | `/api/costs`        | Cost tracking            |
| [Webhooks](#webhooks)             | `/api/v1/webhooks`  | External webhooks        |
| [Health](#health)                 | `/api/v1/health`    | Service health           |

---

## Authentication

### Signup

```http
POST /api/auth/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe",
  "organizationName": "Acme Inc"
}
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

### Get Current User

```http
GET /api/auth/me
Authorization: Bearer <token>
```

### Logout

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

---

## Events

### List Events (Paginated)

```http
GET /api/events?page=1&pageSize=20&severity=high&status=completed&search=TypeError
Authorization: Bearer <token>
```

### Get Recent Events

```http
GET /api/events/recent?limit=10
Authorization: Bearer <token>
```

### Get Event Detail

```http
GET /api/events/:eventId
Authorization: Bearer <token>
```

### Get Event RCA

```http
GET /api/events/:eventId/rca
Authorization: Bearer <token>
```

### Reanalyze Event

```http
POST /api/events/:eventId/reanalyze
Authorization: Bearer <token>
```

---

## RCA

### Get RCA by ID

```http
GET /api/rca/:rcaId
Authorization: Bearer <token>
```

### Submit Feedback

```http
POST /api/rca/:rcaId/feedback
Authorization: Bearer <token>
Content-Type: application/json

{
  "actual_root_cause": "The real issue was...",
  "feedback_notes": "Additional context..."
}
```

---

## Dashboard

### Get Dashboard Stats

```http
GET /api/dashboard/stats
Authorization: Bearer <token>
```

**Response:**

```json
{
  "totalEvents": 1450,
  "eventsChange": 12.5,
  "resolvedRCAs": 1200,
  "resolvedChange": 8.3,
  "avgResolutionTime": 45,
  "resolutionTimeChange": -15.2,
  "pendingAnalysis": 35
}
```

---

## Integrations

### List Integrations

```http
GET /api/integrations
Authorization: Bearer <token>
```

### Configure Sentry (API Key)

```http
POST /api/integrations/sentry/configure
Authorization: Bearer <token>
Content-Type: application/json

{
  "dsn": "https://...@sentry.io/...",
  "project": "my-app",
  "environment": "production"
}
```

### Connect GitHub (OAuth)

```http
GET /api/integrations/github/connect
→ Redirects to GitHub OAuth
```

### Connect Slack (OAuth)

```http
GET /api/integrations/slack/connect
→ Redirects to Slack OAuth
```

### Connect Jira (OAuth)

```http
GET /api/integrations/jira/connect
→ Redirects to Jira OAuth
```

### Connect Teams (OAuth)

```http
GET /api/integrations/teams/connect
→ Redirects to Microsoft OAuth
```

### Disconnect Integration

```http
DELETE /api/integrations/:integrationId
Authorization: Bearer <token>
```

---

## Settings

### Get Organization Settings

```http
GET /api/settings/organization
Authorization: Bearer <token>
```

### Update Settings

```http
PATCH /api/settings/organization
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Acme Corp",
  "settings": {
    "slack_channel": "#critical-bugs",
    "notification_level": "critical",
    "auto_analyze": true,
    "daily_digest": false,
    "weekly_report": true
  }
}
```

---

## Costs

### Get Cost Summary

```http
GET /api/costs/summary
Authorization: Bearer <token>
```

### Get Daily Costs

```http
GET /api/costs/daily?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <token>
```

---

## Webhooks

### Sentry Webhook

```http
POST /api/v1/webhooks/sentry
Content-Type: application/json
Sentry-Hook-Resource: event_alert
Sentry-Hook-Signature: <hmac-sha256-signature>

{
  "action": "created",
  "data": {
    "event": {...}
  }
}
```

### GitHub Webhook

```http
POST /api/v1/webhooks/github
Content-Type: application/json
X-GitHub-Event: push
X-Hub-Signature-256: sha256=<signature>

{
  "ref": "refs/heads/main",
  "repository": {...},
  "commits": [...]
}
```

---

## Health

### Liveness Check

```http
GET /api/v1/health
```

### Readiness Check

```http
GET /api/v1/ready
```

---

## Query Parameters Reference

### Events List (`/api/events`)

- `page` (number, min: 1, default: 1)
- `pageSize` (number, min: 1, max: 100, default: 20)
- `severity` (enum: `low`, `medium`, `high`, `critical`)
- `status` (enum: `pending`, `processing`, `completed`, `failed`)
- `search` (string, max: 200 chars)
- `environment` (string, max: 50 chars)

### Recent Events (`/api/events/recent`)

- `limit` (number, min: 1, max: 20, default: 5)

### Daily Costs (`/api/costs/daily`)

- `startDate` (string, format: YYYY-MM-DD)
- `endDate` (string, format: YYYY-MM-DD)

---

## Response Status Codes

| Code | Meaning           | When                           |
| ---- | ----------------- | ------------------------------ |
| 200  | OK                | Successful GET/PATCH/DELETE    |
| 201  | Created           | Successful POST (new resource) |
| 202  | Accepted          | Async processing started       |
| 400  | Bad Request       | Validation error               |
| 401  | Unauthorized      | Missing/invalid token          |
| 403  | Forbidden         | Insufficient permissions       |
| 404  | Not Found         | Resource not found             |
| 409  | Conflict          | Resource exists                |
| 429  | Too Many Requests | Rate limited                   |
| 500  | Server Error      | Internal error                 |
| 503  | Unavailable       | Service not ready              |

---

## Rate Limits

| Plan       | Limit          |
| ---------- | -------------- |
| Free       | 100 req/hour   |
| Pro        | 1,000 req/hour |
| Enterprise | Custom         |

**Headers:**

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1705320000
```

---

## Error Response Format

```json
{
  "error": "Validation Error",
  "message": "Password must be at least 8 characters",
  "details": {
    "field": "password",
    "constraint": "minLength"
  }
}
```

---

## cURL Examples

### Signup

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "name": "John Doe",
    "organizationName": "Acme Inc"
  }'
```

### Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

### Get Events

```bash
curl -X GET "http://localhost:3000/api/events?page=1&pageSize=20" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Get Dashboard Stats

```bash
curl -X GET http://localhost:3000/api/dashboard/stats \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Submit RCA Feedback

```bash
curl -X POST http://localhost:3000/api/rca/rca-123/feedback \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "actual_root_cause": "The real issue was a race condition",
    "feedback_notes": "Deterministic analysis was correct"
  }'
```

---

## Environment Variables for Postman

```json
{
  "base_url": "http://localhost:3000",
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

**Last Updated:** January 2024
