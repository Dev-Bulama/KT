# Checkpoint — 2026-10-11

Status record for anyone continuing this work. It reflects what was actually built and run in the development environment. **No deployment has been performed.**

## Completed phases

1. Architecture, data model and migrations (Prisma 7, PostgreSQL; integrity triggers, CHECK constraints, full-text indexes).
2. Authentication and RBAC: Argon2id, hashed sessions, TOTP MFA, rate limiting, 72 permissions, 8 default roles, row-level scope.
3. MDA onboarding: self-registration and email verification, KATDICT review and activation, invitations, CSV directory import with claiming.
4. Service catalogue (26 editable categories), request wizard, request workflow, configurable approval policy with separation of duties.
5. Projects: initiation, assignments and acknowledgement, milestones, tasks, risks, dependencies, progress methods, deliverables, completion review, MDA acceptance/dispute/remediation, closure.
6. Reports: completion report (database-derived, PDF + CSV), periodic reports, exports; hash-chained audit with verification.
7. Notifications (in-app + transactional email outbox via cron), SLA calendar and escalations, early warning, data quality, system health.
8. AI layer (12 features) behind a policy gate with deterministic fallbacks; AI never approves, assigns or closes anything.
9. UI for all roles (dashboards, search, analytics, knowledge base, feedback/complaints, admin).
10. Tests (unit, integration, E2E), documentation, deployment guide.

## Repository structure

```
prisma/            schema, migrations, seed (base + fictional demo), catalogue data
scripts/           import-mdas, recover-super-admin, verify-audit-chain, gen-permission-matrix
src/app/           (public) (auth) (account) (app) route groups; api/ route handlers (files, reports, exports, cron, health)
src/components/    ui, layout, forms, charts, shared
src/lib/           env, db, logger, errors, crypto, rate-limit, csv, action helpers
src/modules/       domain services: auth, rbac, audit, notifications, mdas, requests, approvals, catalog, sla,
                   projects, reports, files, admin, feedback, knowledge, analytics, intelligence, quality, ai, search, settings
src/proxy.ts       request proxy (Next.js 16 replacement for middleware)
tests/             unit/, integration/, e2e/
docs/              architecture, database (ERD), permissions, AI, security, deployment, MDA import, testing, readiness
```

## Verification run in this environment

See [TESTING.md](TESTING.md#latest-results-2026-10-11-this-environment):

- 95/95 unit and integration tests passed.
- 9/9 Playwright E2E tests passed against a production build.
- Typecheck is clean; lint has 0 errors.
- `npm run build` succeeded.
- Audit chain verification passes.

## Known gaps and pending items

- **Live AI calls not exercised** (no API key available). Only the fallback paths and schema validation are tested.
- Resend email and S3 storage drivers were not exercised against real providers. Locally, the console email driver and local storage were used.
- **No official MDA directory is loaded.** The verified list must be imported by KATDICT (see MDA_IMPORT.md). Demo MDAs are fictional and labelled DEMO.
- **Configuration needs confirming with KATDICT management:** approval thresholds, SLA targets and departments. Public holidays must also be loaded.
- **Not implemented:**
  - Malware scanning requires an external scanner (a hook exists, and it fails closed).
  - CSP still allows `'unsafe-inline'`; a nonce-based CSP is recommended.
- **Organisational steps:**
  - Independent penetration test.
  - Backup and restore test.
  - Legal review of the privacy notice.
  - User acceptance testing with pilot MDAs.
  - Formal go-live approval.

See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) for the full list.

## Useful commands

```bash
npm run db:deploy                 # apply migrations (never resets data)
npm run db:seed                   # base data + initial Super Admin (SEED_SUPER_ADMIN_* vars)
npm run db:seed -- --demo         # fictional demo data (refused in production)
npm run test:unit && npm run test:integration && npm run test:e2e
npm run build
npm run audit:verify
```

## Next steps

1. Provision staging (DEPLOYMENT.md), run migrations and the base seed, and run the E2E suite against staging.
2. Load the verified MDA directory, holidays and confirmed thresholds.
3. Decide on AI enablement and document the data-governance approval.
4. Complete the SECURITY.md checklist and arrange the penetration test.
