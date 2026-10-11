# Deployment guide (Vercel + managed PostgreSQL + S3-compatible storage + Resend)

> This guide describes how to deploy. **No production deployment has been performed as part of this build.**

## 1. Architecture

| Component | Recommended service | Notes |
|---|---|---|
| Application | Vercel (Pro recommended for 5-minute crons) | Next.js 16 serverless functions, region close to Nigeria (e.g. `fra1`/`cdg1`/`lhr1`) |
| Database | Neon, Supabase, or AWS RDS PostgreSQL 15+ | Use the **pooled** URL for `DATABASE_URL`, direct URL for `DIRECT_URL`; enable PITR backups |
| Object storage | AWS S3, Cloudflare R2, or other S3-compatible | Private bucket, block public access, SSE enabled |
| Email | Resend | Verify the sending domain (SPF, DKIM, DMARC) |
| AI (optional) | Anthropic API | Only after data-governance approval |

Vercel's filesystem is ephemeral: the app never stores uploads locally in production (`STORAGE_DRIVER=local` is refused), and background work runs through the database outbox + cron endpoints, not long-running processes.

## 2. Prerequisites

- Node.js 22+, npm, Git, a GitHub repository with this code.
- Accounts for Vercel, the PostgreSQL provider, the storage provider and Resend.
- A domain (e.g. `spimp.katsinastate.gov.ng`) you control.

## 3. Local setup

See the README quick start. Use `EMAIL_PROVIDER=console`, `STORAGE_DRIVER=local`, `AI_PROVIDER=disabled` locally.

## 4. PostgreSQL

1. Create a database (e.g. `katdict`) in the region nearest the Vercel deployment.
2. Create two roles (recommended): a **migration** role (owner of the schema) and an **application** role with `SELECT/INSERT/UPDATE/DELETE` on tables and `USAGE` on sequences, without the right to drop/alter triggers. Point `DIRECT_URL` at the migration role and `DATABASE_URL` (pooled) at the application role.
3. Always use `sslmode=require`.

## 5. Object storage

Create a private bucket. For AWS S3: block all public access, enable default encryption, create an IAM user/role limited to `s3:PutObject` and `s3:GetObject` on `arn:aws:s3:::BUCKET/*`. For Cloudflare R2: create an API token scoped to the bucket and set `OBJECT_STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `OBJECT_STORAGE_REGION=auto`. No CORS configuration is needed (uploads go through the app; downloads use presigned URLs).

## 6. Email (Resend)

Add and verify the sending domain, create an API key with send permission, set `RESEND_API_KEY` and `EMAIL_FROM`.

## 7. Environment variables

Copy every variable from [`.env.example`](../.env.example) into Vercel → Project → Settings → Environment Variables (Production, and separately Preview with **different** databases/buckets). All are server-only; none are exposed to the browser. Generate secrets with `openssl rand -base64 48`.

## 8. Vercel project

1. Vercel → *Add New Project* → import the GitHub repository. Framework preset: Next.js.
2. Build command: `npm run build` (runs `prisma generate && next build`). Install command: `npm install`. Output: default.
3. Set environment variables (step 7).
4. Crons are declared in [`vercel.json`](../vercel.json) (`/api/cron/outbox` every 5 min, `/api/cron/escalations` hourly). Vercel sends `Authorization: Bearer $CRON_SECRET`. On the Hobby plan crons run at most once per day — use Pro, or call the same endpoints from an external scheduler with the bearer header.
5. GitHub integration: pushes to the production branch deploy to Production; pull requests get Preview deployments (use a separate Preview database).

## 9. Database migrations (safe)

Run migrations **before** promoting a new deployment, from CI or a trusted machine:

```bash
DATABASE_URL=$DIRECT_URL DIRECT_URL=$DIRECT_URL npx prisma migrate deploy
```

`migrate deploy` only applies pending migrations; it never resets data. Never run `prisma migrate dev`, `migrate reset` or `db push` against production. Migrations are forward-only; for risky changes use expand/contract (add columns, backfill, then remove in a later release).

## 10. Seeding (first deployment)

```bash
SEED_SUPER_ADMIN_EMAIL=... SEED_SUPER_ADMIN_NAME="..." SEED_SUPER_ADMIN_PASSWORD='...' \
DATABASE_URL=$DIRECT_URL npm run db:seed
```

This loads permissions, roles, default departments, the 26 service categories and the default approval policy (all editable), and creates the initial Super Administrator. Remove the `SEED_SUPER_ADMIN_*` values afterwards. **Do not** use `--demo` in production. Then sign in, enrol MFA, invite staff, configure holidays and thresholds, and import the verified MDA directory.

## 11. Production build

```bash
npm ci && npm run typecheck && npm run lint && npm run test:unit && npm run build
```

## 12. Custom domain

Vercel → Project → Settings → Domains → add the domain and create the DNS records shown (CNAME `cname.vercel-dns.com` or A records). Update `APP_URL` to the final `https://` URL and redeploy.

## 13. Deployment verification

1. `GET /api/health` → `{"status":"ok"}`.
2. Sign in as the Super Administrator; enrol MFA; confirm the MFA challenge on next sign-in.
3. Admin › System health: database latency, email provider = resend, storage = s3.
4. Admin › Notification queue: *Run delivery now*; confirm a test invitation email arrives.
5. Upload a small PDF on a test request (Preview environment) and download it (presigned redirect).
6. Admin › Audit log → *Verify integrity* passes.
7. Confirm cron executions in Vercel → Logs (outbox and escalations return `{"ok":true}`).
8. Confirm security headers (e.g. `curl -I https://…/login` shows CSP, HSTS, X-Frame-Options).

## 14. Backups and recovery

- Enable automated daily backups **and** point-in-time recovery (Neon/Supabase/RDS), retention ≥ 30 days.
- Weekly logical export (`pg_dump --format=custom`) to separate, access-controlled storage (different account/region).
- Enable object versioning on the bucket (protects against accidental overwrite/deletion).
- Test a restore at least quarterly into a scratch database; run `npm run audit:verify` against it.

## 15. Rollback

- **Application:** Vercel → Deployments → select the previous healthy deployment → *Promote to Production* (instant).
- **Database:** migrations are forward-only; if a release must be rolled back, the previous app version must be compatible with the current schema (follow expand/contract). For data corruption, restore via PITR to a new database, verify, and switch `DATABASE_URL`.

## 16. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `Invalid environment configuration` in logs | Missing/short `AUTH_SECRET`, missing `DATABASE_URL`, or `STORAGE_DRIVER=local` in production. |
| Login works but every page redirects to `/account/security?enroll=1` | Privileged user without MFA while `security.requireMfaForPrivileged` is on — enrol MFA. |
| Emails not arriving | Admin › Notification queue shows `FAILED/DEAD` with provider errors; check `RESEND_API_KEY`, domain verification and that crons run. |
| Uploads fail with 413 | File exceeds `FILE_UPLOAD_MAX_SIZE` / Vercel body limit (~4.5 MB). |
| `prepared statement … already exists` / too many connections | Use the provider's pooled URL for `DATABASE_URL`; lower `DATABASE_POOL_MAX`. |
| Downloads return 403 from storage | Bucket credentials lack `GetObject`, or clock skew affecting presigned URLs. |
| AI features show "rule-based" | Expected unless `AI_PROVIDER`, `AI_API_KEY` and `ai.externalProcessingApproved` are all set. |
