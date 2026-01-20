# Buglens API Documentation

Complete API documentation for Buglens - AI-powered RCA (Root Cause Analysis) copilot for production incidents.

## 📦 Postman Collection

Import the Postman collection to test all API endpoints:

**File:** `docs/Buglens_API.postman_collection.json`

### How to Import

1. Open Postman
2. Click **Import** button
3. Select `Buglens_API.postman_collection.json`
4. Collection will be imported with all endpoints, examples, and documentation

## 🔐 Authentication

Most endpoints require Bearer token authentication. After signup/login, you'll receive an access token.

### Setup in Postman

1. **Import the collection**
2. **Set environment variables:**
   - `base_url`: `http://localhost:3000` (development) or `https://api.buglens.io` (production)
   - `access_token`: Your JWT token from login/signup

3. **Using the token:**
   - The collection has collection-level auth configured
   - All authenticated endpoints automatically use `{{access_token}}`
   - After login, copy the `accessToken` from response and paste into `access_token` variable

### Get an Access Token

```bash
# Method 1: Signup (creates new user + org)
POST {{base_url}}/api/auth/signup
{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe",
  "organizationName": "Acme Inc"
}

# Method 2: Login (existing user)
POST {{base_url}}/api/auth/login
{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}

# Response:
{
  "user": {...},
  "organization": {...},
  "accessToken": "eyJhbGc..."  ← Copy this!
}
```

## 🏗️ API Architecture

### Base URLs

- **Development:** `http://localhost:3000`
- **Production:** `https://api.buglens.io`

### API Versioning

- `/api/v1/*` - Versioned endpoints (health, webhooks)
- `/api/*` - Current version endpoints (most routes)

### Multi-Tenancy

All authenticated requests are scoped to the organization in your JWT token's `orgId` claim. You can only access data for your organization.

### Rate Limits

| Plan       | Requests/Hour |
| ---------- | ------------- |
| Free       | 100           |
| Pro        | 1,000         |
| Enterprise | Custom        |

Rate limit info is returned in response headers:

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1705320000
```

## 📚 API Endpoints

### 1. Authentication

| Endpoint           | Method | Auth   | Description                        |
| ------------------ | ------ | ------ | ---------------------------------- |
| `/api/auth/signup` | POST   | None   | Register new user and organization |
| `/api/auth/login`  | POST   | None   | Login with email/password          |
| `/api/auth/me`     | GET    | Bearer | Get current user info              |
| `/api/auth/logout` | POST   | Bearer | Logout and invalidate session      |

### 2. Health & Monitoring

| Endpoint         | Method | Auth | Description                         |
| ---------------- | ------ | ---- | ----------------------------------- |
| `/api/v1/health` | GET    | None | Liveness probe (basic health)       |
| `/api/v1/ready`  | GET    | None | Readiness probe (dependency checks) |

### 3. Events

| Endpoint                    | Method | Auth   | Description                         |
| --------------------------- | ------ | ------ | ----------------------------------- |
| `/api/events`               | GET    | Bearer | List events (paginated, filterable) |
| `/api/events/recent`        | GET    | Bearer | Recent events for dashboard         |
| `/api/events/:id`           | GET    | Bearer | Get event detail                    |
| `/api/events/:id/rca`       | GET    | Bearer | Get RCA for event                   |
| `/api/events/:id/reanalyze` | POST   | Bearer | Trigger re-analysis                 |

### 4. RCA (Root Cause Analysis)

| Endpoint                | Method | Auth   | Description                |
| ----------------------- | ------ | ------ | -------------------------- |
| `/api/rca/:id`          | GET    | Bearer | Get RCA by ID              |
| `/api/rca/:id/feedback` | POST   | Bearer | Submit feedback/correction |

### 5. Dashboard

| Endpoint               | Method | Auth   | Description          |
| ---------------------- | ------ | ------ | -------------------- |
| `/api/dashboard/stats` | GET    | Bearer | Dashboard statistics |

### 6. Integrations

| Endpoint                             | Method | Auth     | Description                |
| ------------------------------------ | ------ | -------- | -------------------------- |
| `/api/integrations`                  | GET    | Bearer   | List all integrations      |
| `/api/integrations/sentry/configure` | POST   | Bearer   | Configure Sentry (API key) |
| `/api/integrations/github/connect`   | GET    | Redirect | Initiate GitHub OAuth      |
| `/api/integrations/slack/connect`    | GET    | Redirect | Initiate Slack OAuth       |
| `/api/integrations/jira/connect`     | GET    | Redirect | Initiate Jira OAuth        |
| `/api/integrations/teams/connect`    | GET    | Redirect | Initiate Teams OAuth       |
| `/api/integrations/:id`              | DELETE | Bearer   | Disconnect integration     |

### 7. Settings

| Endpoint                     | Method | Auth   | Description                |
| ---------------------------- | ------ | ------ | -------------------------- |
| `/api/settings/organization` | GET    | Bearer | Get org settings and usage |
| `/api/settings/organization` | PATCH  | Bearer | Update org settings        |

### 8. Team Management

| Endpoint                       | Method | Auth   | Description               |
| ------------------------------ | ------ | ------ | ------------------------- |
| `/api/team/members`            | GET    | Bearer | List team members         |
| `/api/team/members`            | POST   | Bearer | Invite new member         |
| `/api/team/members/:id/role`   | PATCH  | Bearer | Update member role        |
| `/api/team/members/:id`        | DELETE | Bearer | Remove team member        |
| `/api/team/invites`            | GET    | Bearer | List pending invitations  |
| `/api/team/invites/:id/resend` | POST   | Bearer | Resend invitation email   |
| `/api/team/invites/:id`        | DELETE | Bearer | Cancel pending invitation |

### 9. Costs

| Endpoint             | Method | Auth   | Description                  |
| -------------------- | ------ | ------ | ---------------------------- |
| `/api/costs/summary` | GET    | Bearer | Cost summary and projections |
| `/api/costs/daily`   | GET    | Bearer | Daily cost breakdown         |

### 10. Webhooks (External Services)

| Endpoint                  | Method | Auth | Description                 |
| ------------------------- | ------ | ---- | --------------------------- |
| `/api/v1/webhooks/sentry` | POST   | HMAC | Receive Sentry error events |
| `/api/v1/webhooks/github` | POST   | HMAC | Receive GitHub events       |

### 11. Sentry Tunnel

| Endpoint             | Method | Auth | Description                               |
| -------------------- | ------ | ---- | ----------------------------------------- |
| `/api/sentry-tunnel` | POST   | None | Proxy frontend Sentry events (bypass ads) |

**Purpose:** Routes frontend Sentry events through the backend to bypass ad blockers.

**Content-Type:** `application/x-sentry-envelope`

**Request Body:** Sentry envelope format (automatically handled by Sentry SDK)

**Response:** Proxied response from Sentry (200 on success)

**Frontend Configuration:**

```typescript
Sentry.init({
  dsn: VITE_SENTRY_DSN,
  tunnel: `${API_URL}/api/sentry-tunnel`, // Routes through backend
});
```

**Testing:** See `docs/SENTRY_TESTING_GUIDE.md` for comprehensive testing instructions.

## 🔒 Security

### Webhook Signatures

Webhooks use HMAC-SHA256 signatures for verification:

**Sentry:**

```
Header: Sentry-Hook-Signature
Secret: SENTRY_WEBHOOK_SECRET (from config)
```

**GitHub:**

```
Header: X-Hub-Signature-256
Secret: GITHUB_WEBHOOK_SECRET (from config)
Format: sha256=<signature>
```

### CORS

CORS is enabled for:

- Development: `http://localhost:3001` (frontend dev server)
- Production: `https://app.buglens.io`

## 📊 Common Response Patterns

### Success Response

```json
{
  "success": true,
  "data": {...}
}
```

### Error Response

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "details": {...}  // Optional validation errors
}
```

### HTTP Status Codes

| Code | Meaning               | Usage                                 |
| ---- | --------------------- | ------------------------------------- |
| 200  | OK                    | Successful GET/PATCH/DELETE           |
| 201  | Created               | Successful POST (new resource)        |
| 202  | Accepted              | Request accepted (async processing)   |
| 400  | Bad Request           | Validation error, invalid input       |
| 401  | Unauthorized          | Missing/invalid auth token            |
| 403  | Forbidden             | Valid token, insufficient permissions |
| 404  | Not Found             | Resource doesn't exist                |
| 409  | Conflict              | Resource already exists               |
| 429  | Too Many Requests     | Rate limit exceeded                   |
| 500  | Internal Server Error | Server error                          |
| 503  | Service Unavailable   | Service not ready (dependencies down) |

## 🧪 Testing in Postman

### Quick Start

1. **Import Collection** → `Buglens_API.postman_collection.json`
2. **Set Variables:**
   - `base_url` = `http://localhost:3000`
   - `access_token` = (leave empty initially)
3. **Run Signup:**
   - `Authentication → Signup`
   - Copy `accessToken` from response
4. **Update Variable:**
   - Paste token into `access_token` variable
5. **Test Endpoints:**
   - All authenticated endpoints will now work!

### Test Workflows

#### 1. User Onboarding

```
1. POST /api/auth/signup
2. GET /api/auth/me (verify user)
3. GET /api/settings/organization (check limits)
4. POST /api/integrations/sentry/configure
```

#### 2. Event Analysis Flow

```
1. POST /api/v1/webhooks/sentry (simulate error)
2. GET /api/events/recent (see new event)
3. GET /api/events/:id (check details)
4. GET /api/events/:id/rca (view RCA result)
5. POST /api/rca/:id/feedback (submit correction)
```

#### 3. Dashboard & Monitoring

```
1. GET /api/dashboard/stats
2. GET /api/costs/summary
3. GET /api/events?status=completed&severity=high
```

## 🔧 Environment Setup

### Local Development

```bash
# 1. Start backend
cd /path/to/buglens-v2
docker-compose up -d  # Start Postgres, Redis, LocalStack
npm run dev           # Start API server on :3000

# 2. Set Postman variables
base_url = http://localhost:3000
access_token = (from login)
```

### Production

```bash
# Postman variables
base_url = https://api.buglens.io
access_token = (from login)
```

## 📖 Advanced Usage

### Pagination

Events endpoint supports pagination:

```
GET /api/events?page=2&pageSize=50
```

Response includes metadata:

```json
{
  "events": [...],
  "total": 150,
  "page": 2,
  "pageSize": 50,
  "totalPages": 3
}
```

### Filtering

Events can be filtered:

```
GET /api/events?severity=high&status=completed&search=TypeError
```

Available filters:

- `severity`: `low`, `medium`, `high`, `critical`
- `status`: `pending`, `processing`, `completed`, `failed`
- `search`: Search in message or event ID (max 200 chars)
- `environment`: Filter by environment name

### Cost Tracking

Get costs for specific date range:

```
GET /api/costs/daily?startDate=2024-01-01&endDate=2024-01-31
```

Response includes:

- LLM token usage
- Cost breakdown
- Events processed
- RCAs completed

### Team Management

Manage team members and their roles:

```bash
# List team members
GET /api/team/members?page=1&pageSize=20&search=john

# Invite new member (requires admin/owner role)
POST /api/team/members
{
  "email": "newmember@example.com",
  "role": "member",  // or "admin"
  "name": "New Member"
}

# Update member role (requires owner role)
PATCH /api/team/members/:memberId/role
{
  "role": "admin"  // or "member"
}

# Remove member (requires admin/owner role)
DELETE /api/team/members/:memberId
```

**Role Hierarchy:**

- `owner` - Full access, can transfer ownership, only one per org
- `admin` - Can manage members, integrations, and settings
- `member` - Read access, can view events and RCAs

**Plan Limits:**

| Plan       | Max Team Members |
| ---------- | ---------------- |
| Free       | 3                |
| Pro        | 10               |
| Enterprise | Unlimited        |

## 🐛 Troubleshooting

### Common Issues

**1. 401 Unauthorized**

- Token expired → Login again
- Token missing → Set `access_token` variable
- Wrong format → Should be just the token (no "Bearer" prefix in variable)

**2. 404 Not Found**

- Check `base_url` is correct
- Verify endpoint path (no `/api/api/` double prefix)
- Ensure resource exists and belongs to your org

**3. 429 Rate Limit**

- Wait for rate limit reset (check `X-RateLimit-Reset` header)
- Upgrade plan for higher limits

**4. 403 Webhook Signature**

- Verify `SENTRY_WEBHOOK_SECRET` or `GITHUB_WEBHOOK_SECRET`
- Check HMAC calculation
- Ensure raw body is used for signature validation

## 📝 Changelog

### Version 1.0 (Phase 1 Complete)

- ✅ Authentication (signup, login, logout, me)
- ✅ Events (list, detail, recent, reanalyze)
- ✅ RCA (get, feedback)
- ✅ Dashboard (stats)
- ✅ Integrations (Sentry, GitHub, Slack, Jira, Teams)
- ✅ Settings (get, update)
- ✅ Costs (summary, daily)
- ✅ Webhooks (Sentry, GitHub)
- ✅ Health checks (liveness, readiness)
- ✅ Team Management (members, invites, roles)

## 🤝 Support

- **Documentation:** See `/docs` folder
- **GitHub:** [Buglens Repository](https://github.com/yourusername/buglens)
- **Issues:** Report bugs on GitHub Issues

## 📄 License

[Add your license here]

---

**Last Updated:** January 2024
**API Version:** v1.0
**Postman Collection Version:** 2.1.0
