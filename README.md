# KATDICT Service & Project Intelligence Management Platform (KATDICT-SPIMP)

A production-oriented web platform for the **Katsina State Directorate of Information and Communication Technology (KATDICT)** through which the State's ~120 Ministries, Departments and Agencies (MDAs) request ICT services, and KATDICT assesses, approves, assigns, delivers, accepts and closes the resulting projects, with role-based dashboards, a tamper-evident audit trail, automatic completion reports and AI assistance that never takes decisions on anyone's behalf.

> **Status:** development build for a **controlled pilot**. Development completion is distinct from formal government acceptance, security certification and production authorisation. See [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## Contents

| Document | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture, modules, workflows, assumptions |
| [docs/DATABASE.md](docs/DATABASE.md) | ER diagram (Mermaid) and key relationships |
| [docs/PERMISSION_MATRIX.md](docs/PERMISSION_MATRIX.md) | Role–permission matrix (generated from code) |
| [docs/AI.md](docs/AI.md) | AI architecture, features and security boundaries |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model (OWASP), controls, security checklist, emergency recovery |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel + managed PostgreSQL + S3 + Resend deployment, backup, rollback |
| [docs/MDA_IMPORT.md](docs/MDA_IMPORT.md) | Verified MDA directory CSV import |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy and how to run each suite |
| [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) | Readiness checklist and definition-of-done status |
| [docs/CHECKPOINT.md](docs/CHECKPOINT.md) | Project checkpoint: completed work, known gaps, next steps |

## Technology

Next.js 16 (App Router, Server Components, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 (shadcn-style components with Radix primitives) · Lucide · Recharts · PostgreSQL · Prisma 7 (pg driver adapter, explicit migrations) · Zod · React Hook Form · Argon2id · TOTP MFA (otplib) · Resend (pluggable email provider) · S3-compatible private storage · Anthropic Claude via a provider-agnostic AI layer (optional) · pdf-lib · Vitest · Playwright.

Authentication is implemented in-house on top of vetted primitives (Argon2id, 256-bit random session tokens stored as SHA-256 hashes, `__Host-` cookies, TOTP) rather than Auth.js, because the requirements call for server-side session revocation, idle/absolute expiry, enforced MFA for privileged roles and lockout monitoring, which Auth.js's credentials provider (JWT-only) does not support well. See [docs/ARCHITECTURE.md §Authentication](docs/ARCHITECTURE.md#authentication).

## Quick start (local development)

Prerequisites: Node.js 22+, PostgreSQL 15+.

```bash
npm install
cp .env.example .env            # then edit: DATABASE_URL, DIRECT_URL, AUTH_SECRET, APP_URL
# local dev values: EMAIL_PROVIDER=console STORAGE_DRIVER=local AI_PROVIDER=disabled
npx prisma migrate deploy       # apply migrations
npm run db:seed -- --demo       # base configuration + FICTIONAL demo data
npm run dev                     # http://localhost:3000
```

Demo accounts (fictional, `*.katdict.test`, password `Demo-Passw0rd-2026`; MFA enforcement is switched off by the demo seed only):

| Role | Email |
|---|---|
| Super Administrator | superadmin@demo.katdict.test |
| Director-General | director@demo.katdict.test |
| Operations Administrator | operations@demo.katdict.test (and operations2@…) |
| Department Head (Software) | head.software@demo.katdict.test |
| ICT Officer | officer1@demo.katdict.test |
| Auditor | auditor@demo.katdict.test |
| MDA Administrator | admin@demo-mes.katdict.test |
| MDA Staff | staff@demo-mes.katdict.test |

All demo MDAs are prefixed **DEMO** and are not real institutions. The platform deliberately ships with **no official MDA names**; load the verified directory with `npm run mda:import` (see [docs/MDA_IMPORT.md](docs/MDA_IMPORT.md)).

## Scripts

| Command | Description |
|---|---|
| `npm run dev` / `build` / `start` | Develop / production build / serve |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint |
| `npm run db:deploy` | Apply migrations (safe for production; never resets) |
| `npm run db:seed` | Base configuration (+ initial Super Admin from `SEED_SUPER_ADMIN_*`) |
| `npm run db:seed -- --demo` | Also load fictional demo data (refused when `NODE_ENV=production`) |
| `npm run mda:import -- file.csv [--apply --actor email]` | Validate / import the verified MDA directory |
| `npm run audit:verify` | Verify the audit hash chain |
| `npm run admin:recover -- --email … --witness …` | Emergency Super Admin recovery (see SECURITY.md) |
| `npm run test:unit` · `test:integration` · `test:e2e` | Test suites (see [docs/TESTING.md](docs/TESTING.md)) |

## Repository layout

```
prisma/            schema.prisma, migrations/, seed scripts, default catalogue data
scripts/           MDA import, audit verification, emergency recovery, docs generator
src/app/           Next.js routes: (public), (auth), (account), (app) authenticated area, api/
src/components/    design system (ui/), layout shell, forms, charts, shared record views
src/lib/           db, env, errors, crypto, rate limiting, CSV, references, action helpers
src/modules/       domain modules (business logic + authorization), see ARCHITECTURE.md
tests/             unit/, integration/ (real PostgreSQL), e2e/ (Playwright)
docs/              architecture, database, security, deployment, AI, readiness, checkpoint
```
