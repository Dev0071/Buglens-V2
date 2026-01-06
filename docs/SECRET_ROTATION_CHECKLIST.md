# Secret Rotation Implementation Checklist

Use this checklist to track progress during implementation.

---

## Week 7: Foundation

### Day 1-2: Database & Core Service

- [ ] **Database Migration**
  - [ ] Create `migrations/024_add_secret_versioning.cjs`
  - [ ] Add `secret_versions` table
  - [ ] Add `secret_rotation_events` table
  - [ ] Run migration on dev database
  - [ ] Verify schema with `\d secret_versions` in psql

- [ ] **Secret Manager Service**
  - [ ] Create `src/services/secret-manager.ts`
  - [ ] Implement `getSecret(type, version)`
  - [ ] Implement `getSecretWithFallback(type)`
  - [ ] Implement `rotateSecret(type, options)`
  - [ ] Implement `cleanupExpiredSecrets()`
  - [ ] Implement `getRotationStatus()`
  - [ ] Add in-memory caching (5-minute TTL)
  - [ ] Test locally with sample secrets

### Day 3-4: Service Integration

- [ ] **Update Auth Service**
  - [ ] Modify `generateAccessToken()` to use versioned secrets
  - [ ] Modify `verifyAccessToken()` with fallback logic
  - [ ] Modify `generateRefreshToken()` if needed
  - [ ] Test: Generate token, rotate secret, verify old token still works

- [ ] **Update Crypto Service**
  - [ ] Support multi-version encryption keys in `encryptData()`
  - [ ] Support multi-version decryption in `decryptData()`
  - [ ] Implement `reEncryptAllData()` for bulk re-encryption
  - [ ] Test: Encrypt, rotate, decrypt should still work

- [ ] **Update GitHub Service**
  - [ ] Use versioned webhook secrets for signature validation
  - [ ] Support fallback verification
  - [ ] Test: Send webhook, rotate secret, old webhook still validates

### Day 5: Testing

- [ ] **Unit Tests**
  - [ ] Test `getSecret()` with cache
  - [ ] Test `getSecretWithFallback()` fallback logic
  - [ ] Test `rotateSecret()` version promotion
  - [ ] Test `cleanupExpiredSecrets()`
  - [ ] Run: `npm test tests/unit/secret-manager.test.ts`

- [ ] **Integration Tests**
  - [ ] Test JWT rotation with active sessions
  - [ ] Test encryption key rotation with re-encryption
  - [ ] Test webhook secret rotation
  - [ ] Run: `npm test tests/integration/secret-rotation.test.ts`

---

## Week 8: Automation & UI

### Day 1-2: Admin API

- [ ] **API Routes**
  - [ ] Create `src/api/routes/admin/secrets.ts`
  - [ ] Implement `POST /api/admin/secrets/rotate`
  - [ ] Implement `GET /api/admin/secrets/status`
  - [ ] Implement `POST /api/admin/secrets/cleanup`
  - [ ] Add role-based access control (owner + platform_admin)
  - [ ] Test with Postman/cURL

- [ ] **API Documentation**
  - [ ] Update OpenAPI spec with new endpoints
  - [ ] Add examples to Postman collection
  - [ ] Document required roles

### Day 3-4: Frontend

- [ ] **Admin UI**
  - [ ] Create `web/src/pages/admin/SecretsManagement.tsx`
  - [ ] Display secret status table
  - [ ] Add "Rotate Now" buttons
  - [ ] Add confirmation modal
  - [ ] Add progress indicator
  - [ ] Add success/error notifications
  - [ ] Test in development mode

- [ ] **Error Handling**
  - [ ] Update `web/src/api/client.ts` with 401 auto-refresh
  - [ ] Handle rotation failures gracefully
  - [ ] Show user-friendly error messages

### Day 5: CLI & Automation

- [ ] **CLI Commands**
  - [ ] Create `scripts/rotate-secret.ts`
  - [ ] Add npm script: `npm run secrets:rotate`
  - [ ] Add npm script: `npm run secrets:status`
  - [ ] Add npm script: `npm run secrets:cleanup`
  - [ ] Add npm script: `npm run secrets:init` (backfill)
  - [ ] Test all commands locally

- [ ] **Scheduled Jobs**
  - [ ] Create BullMQ job: `ScheduledSecretRotation`
  - [ ] Add daily cron check for expiring secrets
  - [ ] Auto-rotate if < 7 days until expiration
  - [ ] Send Slack notification before auto-rotation

---

## Week 9: Polish & Deploy

### Day 1-2: Documentation

- [ ] **User Documentation**
  - [ ] Add admin guide: "How to Rotate Secrets"
  - [ ] Add troubleshooting section
  - [ ] Document rotation schedules

- [ ] **Developer Documentation**
  - [ ] Update API docs
  - [ ] Add code comments
  - [ ] Create runbook for emergencies

### Day 3: Security Review

- [ ] **Code Review**
  - [ ] Security team review
  - [ ] Check for secret leakage in logs
  - [ ] Verify RBAC enforcement
  - [ ] Review encryption implementation

- [ ] **Penetration Testing**
  - [ ] Attempt to access secrets without proper role
  - [ ] Test rotation rollback scenarios
  - [ ] Verify grace period enforcement

### Day 4: Staging Deployment

- [ ] **Staging Tests**
  - [ ] Deploy to staging
  - [ ] Backfill current secrets: `npm run secrets:init`
  - [ ] Perform test rotation: `npm run secrets:rotate -- --type jwt_secret`
  - [ ] Verify no user disruption
  - [ ] Check logs for errors
  - [ ] Test admin UI

- [ ] **Load Testing**
  - [ ] Generate 1000 concurrent requests during rotation
  - [ ] Verify <1% error rate
  - [ ] Check CloudWatch metrics

### Day 5: Production Rollout

- [ ] **Pre-Production**
  - [ ] Backup production database
  - [ ] Document rollback procedure
  - [ ] Schedule deployment window (low traffic time)
  - [ ] Notify team in Slack

- [ ] **Production Deployment**
  - [ ] Deploy migration: `npm run migrate:up`
  - [ ] Deploy application code
  - [ ] Backfill secrets: `npm run secrets:init`
  - [ ] Monitor for 1 hour
  - [ ] Test admin UI in production

- [ ] **Post-Deployment**
  - [ ] Schedule first rotation (30 days out)
  - [ ] Configure CloudWatch alarms
  - [ ] Update runbook with lessons learned

---

## Validation Checklist

### Functional Tests

- [ ] Can rotate JWT secret without breaking active sessions
- [ ] Can rotate encryption key with successful re-encryption
- [ ] Can rotate webhook secrets without missed webhooks
- [ ] Expired secrets are cleaned up automatically
- [ ] Fallback to previous version works correctly
- [ ] Grace period is enforced (7 days)

### Non-Functional Tests

- [ ] Rotation completes in < 5 minutes
- [ ] Re-encryption throughput > 100 records/sec
- [ ] Zero user-facing errors during rotation
- [ ] All rotations logged in audit trail
- [ ] CloudWatch metrics tracking works
- [ ] Admin UI responsive and intuitive

### Security Tests

- [ ] Only owners/admins can access rotation endpoints
- [ ] Secrets never appear in logs
- [ ] Database secrets are encrypted
- [ ] CSRF protection on rotation endpoints
- [ ] Rate limiting on API endpoints

---

## Rollback Procedure

If anything goes wrong:

### Immediate Rollback (< 5 minutes)

```bash
# 1. Rollback code deployment
heroku releases:rollback -a buglens-api-prod

# 2. Manually revert secret version
npm run secrets:rollback -- --type jwt_secret

# 3. Verify system health
curl https://api.buglens.com/health

# 4. Alert team
# Post in #incidents Slack channel
```

### Database Rollback (if migration fails)

```bash
# Rollback migration
npm run migrate:down

# Redeploy previous version
git push heroku main~1:main --force

# Monitor logs
heroku logs --tail -a buglens-api-prod
```

---

## Success Criteria

- [x] All checklist items completed
- [ ] Security review passed
- [ ] Staging tests passed
- [ ] Production deployment successful
- [ ] Zero incidents in first 48 hours
- [ ] Team trained on rotation procedures

---

## Post-Implementation Tasks

### Week 10+

- [ ] Monitor rotation metrics for 30 days
- [ ] Gather feedback from team
- [ ] Optimize re-encryption performance if needed
- [ ] Document lessons learned
- [ ] Plan AWS Secrets Manager migration (Phase 3)

---

**Status Tracking:**

| Phase      | Status         | Date Completed | Notes  |
| ---------- | -------------- | -------------- | ------ |
| Foundation | ⏳ Not Started | -              | Week 7 |
| Automation | ⏳ Not Started | -              | Week 8 |
| Deployment | ⏳ Not Started | -              | Week 9 |
| Validation | ⏳ Not Started | -              | Week 9 |

---

**Blockers:** (Update as needed)

- None currently identified

**Questions/Concerns:**

- TBD during implementation

---

**Last Updated:** January 5, 2026
