# Production readiness

This checklist separates **development completion** (what this codebase demonstrably does, verified by automated tests) from the **organisational steps** required before a controlled production pilot. Formal government acceptance, security certification and production authorisation are decisions for the competent Katsina State authorities and are outside the scope of software delivery.

## Definition of done — status

Legend: ✅ implemented and verified by automated tests · 🟡 implemented, verified manually or partially · ⬜ organisational / environment step outstanding

| Criterion | Status | Evidence |
|---|---|---|
| Authorised users can register or be invited | ✅ | `onboarding-auth.test.ts`; E2E steps 1–3 |
| Authentication and authorization work correctly | ✅ | `onboarding-auth.test.ts`, `authorization.test.ts` (21 cases) |
| MDA records can be managed securely | ✅ | review/activation/suspension/profile/invitations; isolation tests |
| MDAs can submit service requests | ✅ | lifecycle test; E2E step 4 (wizard) |
| KATDICT can assess and approve requests | ✅ | lifecycle test; E2E steps 5–6 |
| Officers can receive and acknowledge assignments | ✅ | lifecycle test; E2E steps 7–8 |
| Projects can be created and managed | ✅ | lifecycle test; UI smoke crawl across roles |
| Status transitions follow business rules | ✅ | unit state-machine tests; server rejects invalid transitions |
| Notifications are delivered or reliably queued | ✅ | outbox test (failure, retry, backoff); delivery via cron endpoint |
| Deliverables can be uploaded securely | ✅ | magic-byte validation, authorisation tests; E2E step 9 |
| Completion review works | ✅ | lifecycle test; E2E step 10 |
| MDA acceptance works (incl. dispute/remediation) | ✅ | lifecycle test; E2E step 11 |
| Project closure works | ✅ | lifecycle test; E2E step 12 |
| Reports contain accurate database-derived information | ✅ | `report.test.ts`, lifecycle assertions; E2E step 13 (PDF) |
| Audit records are generated correctly | ✅ | lifecycle + E2E step 14; hash-chain verification; DB triggers |
| AI features enforce authorization and provide safe fallbacks | ✅ (fallback paths) / 🟡 (live provider) | scoped-AI tests run with AI disabled; live Anthropic calls not exercised in this environment (no API key) |
| Cross-MDA access restrictions pass automated tests | ✅ | `authorization.test.ts` |
| Production configuration is documented | ✅ | `.env.example`, DEPLOYMENT.md |
| Database backups and recovery procedures are established | ⬜ | procedure documented (DEPLOYMENT.md §14); must be enabled and restore-tested on the chosen provider |
| Critical security findings are addressed | 🟡 | internal review in SECURITY.md; independent penetration test outstanding |
| A representative end-to-end workflow passes | ✅ | `tests/e2e/full-workflow.spec.ts` (see TESTING.md / CHECKPOINT.md for the latest run) |
| The application builds successfully for production | ✅ | `npm run build` (see CHECKPOINT.md) |
| Deployment verification is documented | ✅ | DEPLOYMENT.md §13 |

## Before the pilot (organisational)

- [ ] Confirm approval thresholds, SLA targets, departments and service catalogue with KATDICT management.
- [ ] Load gazetted public holidays into `calendar.holidays`.
- [ ] Import the **verified** official MDA directory (MDA_IMPORT.md).
- [ ] Provision production database, private bucket, Resend domain, Vercel project (DEPLOYMENT.md).
- [ ] Create the initial Super Administrator, enrol MFA, invite KATDICT staff with correct roles and departments.
- [ ] Decide on AI: keep disabled, or document data-governance approval and enable selectively.
- [ ] Connect a malware-scanning service or record the risk acceptance.
- [ ] Complete the security checklist in SECURITY.md, including an independent penetration test.
- [ ] Legal review of the privacy notice; publish official support contact details.
- [ ] Train pilot MDAs and KATDICT staff; agree the support process.
- [ ] Run the E2E suite against the staging environment; perform user acceptance testing with pilot MDAs.
- [ ] Obtain formal approval to go live from the competent authority.

## Operational readiness

- Monitoring: Vercel logs (structured JSON with redaction), Admin › System health (DB latency, failed sign-ins, locked accounts, undeliverable emails, AI usage/fallbacks), `/api/health` for uptime checks.
- Scheduled jobs: outbox (5 min) and escalations (hourly).
- Data quality: Admin › Data quality reviewed weekly.
- Audit integrity: run *Verify integrity* (or `npm run audit:verify`) weekly and after any restore.
