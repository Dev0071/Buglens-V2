# Secret Rotation Quick Reference

**1-Page Cheat Sheet for Engineers**

---

## 🚨 When to Rotate

| Secret                | Schedule       | Trigger       |
| --------------------- | -------------- | ------------- |
| JWT_SECRET            | Every 90 days  | Auto + Manual |
| ENCRYPTION_KEY        | Every 180 days | Manual only   |
| GITHUB_WEBHOOK_SECRET | Every 180 days | Manual        |
| SENTRY_WEBHOOK_SECRET | Every 180 days | Manual        |

**Emergency Rotation:** If a secret is compromised, rotate immediately.

---

## 🔧 How to Rotate

### Via CLI (Recommended)

```bash
# Check rotation status
npm run secrets:status

# Rotate specific secret
npm run secrets:rotate -- --type jwt_secret

# Cleanup expired secrets
npm run secrets:cleanup

# Emergency rollback
npm run secrets:rollback -- --type jwt_secret
```

### Via Admin UI

1. Navigate to `/admin/secrets`
2. Click "Rotate Now" on desired secret
3. Confirm in modal
4. Wait for completion (3-5 minutes)
5. Verify success notification

### Via API

```bash
# Get status
curl -H "Authorization: Bearer $TOKEN" \
  https://api.buglens.com/api/admin/secrets/status

# Rotate
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"secretType":"jwt_secret"}' \
  https://api.buglens.com/api/admin/secrets/rotate
```

---

## 📊 Secret Versions

| Version    | Status       | TTL    | Purpose                 |
| ---------- | ------------ | ------ | ----------------------- |
| `current`  | Active       | -      | Primary secret in use   |
| `previous` | Grace period | 7 days | Fallback for old tokens |
| `next`     | Staged       | -      | Pending activation      |

**Fallback Logic:** System tries `current` first, falls back to `previous` if validation fails.

---

## ⚠️ Impact by Secret Type

### JWT_SECRET

- **User Impact:** None (transparent)
- **Duration:** ~2 minutes
- **Fallback:** Yes (7-day grace period)
- **Action Required:** None

### ENCRYPTION_KEY

- **User Impact:** Brief read-only mode (5-10 mins)
- **Duration:** ~5-10 minutes (depends on data volume)
- **Fallback:** Yes (30-day rollback window)
- **Action Required:** Monitor re-encryption progress

### WEBHOOK_SECRET

- **User Impact:** None
- **Duration:** ~1 minute
- **Fallback:** Yes (7-day grace period)
- **Action Required:** Update secret in external service (GitHub/Sentry)

---

## 🔍 Monitoring

### CloudWatch Metrics

```
SecretRotationSuccess - Count of successful rotations
SecretRotationFailure - Count of failed rotations
SecretRotationDuration - Time taken to rotate (ms)
ReEncryptionProgress - % of records re-encrypted
```

### Health Check

```bash
curl https://api.buglens.com/health
# Check for warnings about expiring secrets
```

### Logs

```bash
# Heroku
heroku logs --tail -a buglens-api-prod | grep "Secret rotation"

# Local
grep "Secret rotation" logs/app.log
```

---

## 🛡️ Security Best Practices

✅ **DO:**

- Rotate on schedule (set calendar reminders)
- Review audit logs monthly
- Test rotation in staging first
- Document external secret updates (GitHub, Sentry)
- Use CLI or UI (never edit database directly)

❌ **DON'T:**

- Skip rotations (compliance risk)
- Share secrets via Slack/email
- Log secrets in plaintext
- Rotate during peak traffic hours
- Delete "previous" version manually

---

## 🔥 Emergency Procedures

### If Rotation Fails

```bash
# 1. Check error message
heroku logs --tail -a buglens-api-prod

# 2. Rollback
npm run secrets:rollback -- --type jwt_secret

# 3. Verify health
curl https://api.buglens.com/health

# 4. Alert team
# Post in #incidents Slack channel
```

### If Secret Leaks

```bash
# 1. IMMEDIATELY rotate
npm run secrets:rotate -- --type jwt_secret

# 2. Revoke compromised secret
# (This happens automatically - old becomes "previous")

# 3. Monitor for suspicious activity
# Check Sentry for unusual 401 errors

# 4. After 7 days, old secret is deleted
npm run secrets:cleanup
```

### If Users Can't Authenticate

```bash
# 1. Check if rotation is in progress
npm run secrets:status

# 2. Verify grace period not expired
# If previous version deleted, users MUST re-login

# 3. Check error rates
# Acceptable: <1% during rotation
# Unacceptable: >5% (trigger rollback)
```

---

## 📞 Who to Contact

| Issue                      | Contact           |
| -------------------------- | ----------------- |
| Rotation failure           | @engineering-team |
| Security concern           | @security-team    |
| User authentication issues | @on-call-engineer |
| CloudWatch alarms          | @devops-team      |

---

## 🗂️ Related Documentation

- [Full Requirements](./technical/SECRET_ROTATION_REQUIREMENTS.md) - 45 pages
- [Implementation Guide](./technical/SECRET_ROTATION_IMPLEMENTATION.md) - 30 pages
- [Executive Summary](./SECRET_ROTATION_SUMMARY.md) - 5 pages
- [Diagrams](./technical/SECRET_ROTATION_DIAGRAMS.md) - Visual architecture
- [Checklist](./SECRET_ROTATION_CHECKLIST.md) - Implementation tracking

---

## 📋 Pre-Flight Checklist (Before Manual Rotation)

- [ ] Low traffic period selected
- [ ] Team notified in Slack
- [ ] Database backup recent (< 24 hours)
- [ ] Staging rotation tested successfully
- [ ] Rollback procedure documented
- [ ] CloudWatch dashboard open for monitoring

---

## 🎯 Quick Troubleshooting

| Symptom                             | Likely Cause              | Fix                              |
| ----------------------------------- | ------------------------- | -------------------------------- |
| 401 errors spiking                  | Rotation broke tokens     | Rollback + verify fallback logic |
| Re-encryption stalled               | Database connection issue | Restart worker, retry            |
| "Secret not found"                  | Cache miss, DB issue      | Clear cache, check DB            |
| Rotation takes > 10 mins            | High data volume          | Normal for encryption_key        |
| Old tokens still valid after 7 days | Cleanup not run           | Run `npm run secrets:cleanup`    |

---

**Version:** 1.0
**Last Updated:** January 5, 2026
**Maintained By:** Security Team

---

**Print this page and keep near your desk!** 🖨️
