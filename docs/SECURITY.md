# Security design, threat model and checklist

This document records the security controls implemented in code, the residual risks, and the checklist to complete before a production pilot. It is an engineering review, **not** a security certification; an independent penetration test and the State's information-security approval are still required.

## 1. Threat model (OWASP Top 10 2021 + ASVS-informed)

| Threat | Controls in this codebase | Where |
|---|---|---|
| **Broken access control / IDOR** | Every service takes an `Actor`; permissions checked server-side; every record lookup is combined with row-level scope (`requestScope`, `projectScope`, `mdaScope`, `complaintScope`, `knowledgeScope`) so browser-supplied ids outside scope return *not found*; MDA users never receive internal comments/tasks/risks/logs/internal files (stripped server-side); download authorisation re-checks the parent record on every request. | `src/modules/rbac/scope.ts`, all services, `files/service.ts` |
| **Privilege escalation** | Users cannot change their own roles or the permissions of a role they hold; only Super Admins grant/remove Super Admin; last Super Admin cannot be removed/suspended; roles are typed by user type (MDA roles can't hold KATDICT permissions; oversight roles stay read-only); role changes revoke sessions. | `admin/users.ts`, `rbac/permissions.ts` |
| **Mass assignment** | Zod schemas whitelist client-settable fields (e.g. MDAs cannot set `mdaId`, `priority`, `status`, estimates); ownership fields are always derived from the actor. Tested. | `requests/schemas.ts`, services |
| **SQL injection** | Prisma parameterised queries; the few raw queries use tagged templates (`$queryRaw\`…${param}\``), never string concatenation of user input. | `lib/rate-limit.ts`, `lib/reference.ts`, `knowledge/service.ts` |
| **XSS / untrusted content rendering** | React escaping; no `dangerouslySetInnerHTML`; user text rendered as text (`whitespace-pre-line`); CSP restricts sources, `frame-ancestors 'none'`, `base-uri`, `form-action 'self'`; email HTML escapes user content. | `next.config.ts`, `notifications/email.ts` |
| **CSRF** | Server Actions are POST-only with Next.js Origin/Host verification; mutating route handlers check `Origin`; session cookie `SameSite=Lax`; GET handlers do not mutate. | `lib/api.ts` |
| **Authentication weaknesses** | Argon2id; password policy; timing-equalised unknown-user path; generic errors; lockout; rate limits; MFA (TOTP) enforced for privileged roles; recovery codes hashed and single-use; new session on login/MFA (no fixation); session revocation on password reset/change, role change, suspension. | `modules/auth/*` |
| **Session management** | 256-bit random tokens, only SHA-256 stored, `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix in production; idle + absolute expiry; user-visible session list with revoke. | `auth/session.ts` |
| **Sensitive data exposure** | No secrets in `NEXT_PUBLIC_*`; logger redacts keys matching password/secret/token/hash/cookie/api key; audit scrubs sensitive keys; TOTP secrets AES-256-GCM encrypted; errors shown to users are curated (`AppError`), unexpected errors are logged with a digest only; `Cache-Control: private, no-store` on authenticated responses and file downloads. | `lib/logger.ts`, `audit/audit.ts`, `lib/action.ts`, `proxy.ts` |
| **Insecure file upload** | Size limit; type determined by **magic bytes** (not filename/MIME); allow-list setting; randomised storage keys; private bucket; downloads via 60-second presigned URLs only after authorisation, with `Content-Disposition: attachment`, `nosniff`, `CSP: sandbox`; malware-scan hook with fail-closed quarantine; quarantined files cannot be downloaded. | `files/*` |
| **SSRF** | The server makes outbound calls only to configured endpoints (email provider, S3 endpoint, AI provider, optional scanner) — never to user-supplied URLs. MDA website URLs are stored, validated as http(s), and never fetched. | — |
| **Unsafe redirects** | `safeRedirectPath` allows only same-origin relative paths (blocks `//`, `/\`, CR/LF). | `lib/utils.ts` |
| **Race conditions / duplicates** | Optimistic concurrency (`version`) on workflow transitions; conditional `updateMany` guards on status; idempotent submission keys; single-use tokens consumed atomically; outbox claims with `FOR UPDATE SKIP LOCKED`; advisory lock serialises the audit hash chain; references from a locked counter row. | services, `lib/reference.ts`, `audit/audit.ts` |
| **Rate-limit bypass** | Limits stored in PostgreSQL (shared across serverless instances), keyed by IP and by account; IP from `x-forwarded-for` (set by Vercel). | `lib/rate-limit.ts` |
| **Insecure exports** | CSV cells beginning with `= + - @ TAB CR` are prefixed with `'`; exports are permission-gated, scoped and audited. | `lib/csv.ts`, `api/exports/*` |
| **Prompt injection / AI data leakage / unauthorised tool use** | See [AI.md](AI.md): scoped retrieval, untrusted-content wrapping, schema validation, no tools, closed analytics catalogue, approval gate, fallbacks. | `modules/ai/*` |
| **Abuse of administrative functions** | All administrative changes audited with before/after; separation of duties (scope preparer can't approve; delivery team can't review/close its own work; authors can't publish their own knowledge; one decision per approver per cycle); exceptional closure needs a dedicated permission + justification. | services |
| **Repudiation / tampering with history** | Append-only triggers on audit and status history; SHA-256 hash chain with verification (`npm run audit:verify`, Admin › Audit log › Verify integrity). A DB superuser could still rewrite data — mitigate with restricted DB roles and off-site exports. | migration `integrity_controls`, `audit/audit.ts` |
| **Security misconfiguration** | Env validation refuses local storage and dev secrets in production; security headers (HSTS, CSP, XFO, nosniff, Referrer-Policy, Permissions-Policy); `poweredByHeader: false`; demo seed refuses `NODE_ENV=production`. | `lib/env.ts`, `next.config.ts` |

### Residual risks / not yet implemented

- CSP allows `'unsafe-inline'` scripts (required by Next.js inline bootstrapping without nonces). Moving to nonce-based CSP is recommended.
- No independent penetration test or dependency audit (`npm audit` reported 0 known vulnerabilities at build time, which is not a substitute).
- Malware scanning depends on an external scanner being configured.
- `x-forwarded-for` trust assumes deployment behind Vercel's edge; adjust if self-hosting.
- Email deliverability (SPF/DKIM/DMARC) must be configured on the sending domain.

## 2. Emergency recovery of the Super Administrator

Use only when no Super Administrator can sign in (lost MFA device, departure).

1. Raise a change ticket; two authorised officers (operator + witness) must be present.
2. From a trusted machine with production database access:
   ```bash
   RECOVERY_CONFIRM=I-UNDERSTAND RECOVERY_TICKET=CHG-123 \
     npm run admin:recover -- --email admin@example.gov.ng --witness "Name of witness"
   ```
3. The script sets a one-time password (printed once), disables MFA, unlocks/reactivates the account, revokes all sessions and writes an `auth.emergency_recovery` audit event naming the ticket and witness.
4. The officer signs in immediately, changes the password and re-enrols MFA. Review the audit log afterwards.

## 3. Audit retention and archival

Audit events are retained for at least `retention.auditYears`. Archival (DBA procedure under change control): export the range to write-once storage, run `npm run audit:verify` and record the result, then a database owner temporarily disables the `audit_event_no_update` trigger, deletes the archived range, re-enables the trigger and records the operation. Note that deleting the oldest records changes the chain's starting point; keep the exported segment and its final hash with the archive.

## 4. Production security checklist

- [ ] `AUTH_SECRET` is ≥32 random characters, stored only in Vercel environment variables (Production scope).
- [ ] `security.requireMfaForPrivileged` is **on**; all privileged users have enrolled MFA.
- [ ] Demo data has **not** been loaded; `SEED_SUPER_ADMIN_*` variables removed after first deployment.
- [ ] Database uses TLS (`sslmode=require`), a least-privilege application role (no superuser, no `ALTER`/`DISABLE TRIGGER`), and a separate migration role used only by `prisma migrate deploy`.
- [ ] Object storage bucket is private (block public access), server-side encryption on, CORS not required (uploads go via the server).
- [ ] `STORAGE_DRIVER=s3`, `EMAIL_PROVIDER=resend` with SPF/DKIM/DMARC on the sending domain.
- [ ] `CRON_SECRET` set; crons configured (Vercel Pro or external scheduler).
- [ ] AI disabled until data-governance approval is documented; if enabled, provider terms reviewed.
- [ ] Malware scanning service connected (or a documented decision to accept `NOT_SCANNED` files).
- [ ] Public holidays configured in `calendar.holidays`; approval thresholds confirmed.
- [ ] Custom domain with HTTPS; HSTS preload considered.
- [ ] Backups enabled with point-in-time recovery; restore tested (see DEPLOYMENT.md).
- [ ] Independent penetration test performed and findings remediated.
- [ ] Privacy notice reviewed by the State's legal/data-protection officers.
- [ ] Incident response contacts and log retention agreed.
