# Secrets Rotation Procedures

> **SOC2 Compliance Documentation**
> Last Updated: January 2025

## Overview

This document outlines the procedures for rotating secrets used by Buglens. Regular rotation of secrets is critical for maintaining security and SOC2 compliance.

## Rotation Schedule

| Secret                 | Rotation Period            | Priority |
| ---------------------- | -------------------------- | -------- |
| JWT Secret             | 90 days                    | Critical |
| Session Secret         | 90 days                    | Critical |
| Database Password      | 90 days                    | Critical |
| PLATFORM_ADMIN_TOKEN   | 30 days                    | Critical |
| AWS Access Keys        | 90 days (prefer IAM roles) | High     |
| GitHub App Private Key | Annually                   | Medium   |
| Webhook Secrets        | Annually                   | Medium   |
| OAuth Client Secrets   | Only if compromised        | Low      |

## Immediate Rotation Required

If any of the following occur, rotate ALL affected secrets immediately:

- Suspected credential exposure
- Employee with access leaves the company
- Security incident detected
- Secret found in logs or version control

## Rotation Procedures

### 1. JWT Secret Rotation

The JWT secret is used to sign authentication tokens. Rotation requires coordination to avoid invalidating active sessions.

**Steps:**

1. Generate new secret:
   ```bash
   openssl rand -hex 64
   ```
2. Update in AWS Secrets Manager:
   ```bash
   aws secretsmanager update-secret \
     --secret-id buglens/jwt-secret \
     --secret-string "NEW_SECRET_VALUE"
   ```
3. Deploy with zero-downtime:
   - Configure application to accept both old and new secrets
   - Deploy new version
   - Wait for all existing tokens to expire (7 days max)
   - Remove old secret acceptance
4. Verify: Check logs for authentication failures

### 2. Session Secret Rotation

Used for encrypting session cookies.

**Steps:**

1. Generate new secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update in AWS Secrets Manager
3. Deploy new version (existing sessions will be invalidated)
4. Notify users if user-facing impact expected

### 3. Database Password Rotation

**Steps:**

1. Create new password:
   ```bash
   openssl rand -base64 32
   ```
2. Update PostgreSQL user password:
   ```sql
   ALTER USER buglens_app WITH PASSWORD 'new_password';
   ```
3. Update connection string in AWS Secrets Manager
4. Rolling restart of application instances
5. Verify: Check database connection logs

### 4. PLATFORM_ADMIN_TOKEN Rotation

Used for admin API authentication.

**Steps:**

1. Generate new token:
   ```bash
   openssl rand -hex 32
   ```
2. Update in AWS Secrets Manager
3. Notify admin users of new token
4. Deploy new version
5. Admin users update their configuration

### 5. AWS Access Keys Rotation

**Prefer using IAM roles for production environments.**

For development access keys:

1. Create new access key in AWS IAM Console
2. Update local .env files
3. Test access with new credentials
4. Deactivate old key
5. Delete old key after 24 hours

### 6. GitHub App Private Key Rotation

**Steps:**

1. Generate new private key in GitHub App settings
2. Upload to AWS Secrets Manager:
   ```bash
   aws secretsmanager update-secret \
     --secret-id buglens/github-app-private-key \
     --secret-string file://new-private-key.pem
   ```
3. Deploy new version
4. Verify GitHub webhooks are working
5. Delete old private key from GitHub App settings

### 7. Webhook Secret Rotation

For Sentry, GitHub, and Slack webhooks:

**Steps:**

1. Generate new secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update in respective platform's webhook settings
3. Update in AWS Secrets Manager
4. Deploy new version
5. Test webhook delivery

### 8. OAuth Client Secrets

**Only rotate if compromised.**

**Steps:**

1. Generate new secret in OAuth provider dashboard (GitHub, Google, etc.)
2. Update in AWS Secrets Manager
3. Deploy new version
4. Verify OAuth flows work

## Verification Checklist

After any secret rotation:

- [ ] Application starts without errors
- [ ] Authentication works (login/logout)
- [ ] API calls succeed
- [ ] Webhooks are received
- [ ] No errors in CloudWatch logs
- [ ] Health check endpoints return 200
- [ ] Admin dashboard accessible

## Emergency Procedures

### Secret Exposure Response

1. **Immediate:** Rotate the exposed secret
2. **Within 1 hour:** Check logs for unauthorized access
3. **Within 24 hours:** Full security audit
4. **Document:** Create incident report

### Lost Access Recovery

If secrets are lost:

1. Check AWS Secrets Manager backup
2. Contact AWS support if needed
3. Regenerate all affected secrets
4. Document the incident

## Audit Trail

All secret rotations must be logged with:

- Date and time
- Person performing rotation
- Reason for rotation
- Verification steps completed

Use the admin audit log API to record rotations:

```bash
curl -X POST https://api.buglens.com/api/admin/audit \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Admin-Token: $ADMIN_TOKEN" \
  -d '{
    "action": "secret.rotated",
    "resourceType": "secret",
    "resourceId": "jwt-secret",
    "details": {
      "reason": "scheduled_rotation",
      "performedBy": "admin@company.com"
    }
  }'
```

## AWS Secrets Manager Configuration

All production secrets should be stored in AWS Secrets Manager with:

- **Encryption:** AWS KMS with customer-managed key
- **Rotation:** Automatic rotation where supported
- **Access:** IAM policies restricting to required services
- **Audit:** CloudTrail logging enabled

Example secret retrieval:

```typescript
import { SecretsManager } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManager({ region: "us-east-1" });

async function getSecret(secretId: string): Promise<string> {
  const response = await client.getSecretValue({ SecretId: secretId });
  return response.SecretString!;
}
```

## References

- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [SOC2 Security Controls](https://www.aicpa.org/topic/audit-assurance/audit-and-assurance-greater-than-soc-2)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
