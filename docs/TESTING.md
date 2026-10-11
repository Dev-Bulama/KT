# Testing

| Suite | Tool | Location | Database | Command |
|---|---|---|---|---|
| Unit | Vitest | `tests/unit/` | none | `npm run test:unit` |
| Integration | Vitest | `tests/integration/` | real PostgreSQL (`TEST_DATABASE_URL`, default `katdict_test`), truncated + reseeded per file | `npm run test:integration` |
| End-to-end | Playwright | `tests/e2e/` | real PostgreSQL (`E2E_DATABASE_URL`, default `katdict_e2e`), reset in global setup; app started on port 3100 | `npm run test:e2e` |

Create the test databases once (local example):

```bash
createdb katdict_test && createdb katdict_e2e
```

Playwright uses its bundled Chromium; set `PLAYWRIGHT_CHROMIUM_PATH` to use a preinstalled browser instead. Test suites refuse to run against database URLs containing `prod`.

## Coverage map

**Unit (pure business rules)**
- Request and project state machines: valid/invalid transitions, permissions, required reasons, available actions.
- Approval policy: threshold logic (ANY threshold), sequencing, rejection/return, missing policy.
- Priority rules (including invalid JSON), progress calculation methods.
- Business calendar, working days with holidays, paused-time SLA breakdown and SLA states.
- Project completion report computation, including "not recorded" handling.
- Security helpers: CSV formula-injection neutralisation and parsing, open-redirect guard, magic-byte sniffing, file-name sanitising, audit canonical hashing, AES-GCM tamper detection.
- Assignment eligibility, dependency-cycle detection, explainable risk rules, similarity clustering, role-permission guardrails, AI output schema validation, NL analytics routing.

**Integration (services + PostgreSQL)**
- Full lifecycle: idempotent submission and reference, history, audit, notifications; triage/assessment/clarification loop/scoping; policy-driven approval with separation of duties; initiation, assignment, acknowledgement; derived progress; evidence-gated completion; KATDICT review; MDA dispute → remediation → acceptance; closure by a non-team officer with report generation and knowledge draft; audit chain verification and DB-level append-only enforcement; outbox delivery with failure, retry and backoff.
- Authorization: MDA A cannot read/list/comment/transition MDA B's records; MDA staff see only own requests; mass-assignment protection; MDA admins cannot edit/invite to other MDAs; unauthorised approvals rejected; director cannot skip steps; stale versions rejected; self-privilege-escalation blocked (own roles, own role permissions, Super Admin protections, cross-user-type roles); officers cannot access unassigned projects, change assignments, close, or bypass review/acceptance; only the requesting MDA can accept; internal notes/tasks/risks never reach MDA users; auditor is read-only; AI classification/assistant/analytics/briefing respect scope and permissions; global search filters by permission; disguised executables rejected; download authorisation for internal vs MDA-visible files.
- Onboarding & authentication: registration → verification (single-use) → review → activation → invitation (single-use, role-restricted); impersonation by name blocked; no email enumeration; generic login errors, lockout, attempt recording; hashed session tokens; password reset revokes sessions; MFA enrolment, encrypted secret, challenge, session rotation, single-use recovery codes; directory import validation (all-or-nothing) and claiming.

**End-to-end (browser, real app)** — `tests/e2e/full-workflow.spec.ts` covers the 14 required steps: MDA registration and email verification (link read from the outbox), KATDICT approval of the MDA and activation, request submission through the 5-step wizard, triage/assessment/technical evaluation/scoping, two-step approval, project initiation and assignment, officer acknowledgement and milestone update, evidence upload and completion submission, KATDICT review, MDA acceptance with rating, closure, completion report and PDF download, audit-trail verification, plus unauthenticated access checks.

## Test data

Tests create their own fictional users and MDAs (`*.test.invalid`, `*.katdict.test`) and never use production credentials. Demo data for manual testing is loaded with `npm run db:seed -- --demo`.
