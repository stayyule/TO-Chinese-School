# Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable walking skeleton of the new TOCS system: CI/CD and single-host deployment, login/password flows, roles and permissions, audit log, people/families, school years, grades and classes, with a React front end for all of it.

**Architecture:** NestJS modular monolith (domain modules, controller → service → Prisma) over the *existing* PostgreSQL database with additive migrations only; server-side sessions in PostgreSQL; default-deny permission codes plus object-level policies; React SPA organized by role, served by Caddy on the same origin as `/api`.

**Tech Stack:** Node.js (current LTS, ≥ 22), TypeScript strict, NestJS, Prisma, PostgreSQL, argon2, Nodemailer, Jest, React + Vite, React Router, TanStack Query, Ant Design, Vitest + Testing Library + MSW, Docker Compose, Caddy, GitHub Actions (GHCR), Ansible.

**Spec:** `docs/superpowers/specs/2026-11-02-system-architecture-design.md` (read it first). Requirements: `docs/requirements/REQUIREMENTS.en.md` / `.zh-CN.md`, `docs/requirements/REVIEW_CHECKLIST.md`. Old behavior lives in `chineseschool/` (read-only reference; never edit it).

## Global Constraints

Copied from the spec; every task includes these.

- Backend NestJS + Prisma + PostgreSQL; front end React (Vite + TypeScript) with Ant Design; UI language English by default, i18n-ready; Chinese names must round-trip intact.
- New code lives in `backend/`, `frontend/`, `deploy/`, `scripts/`, `.github/`. `chineseschool/` is untouched.
- Money is integer cents only (`Cents`); no floats for money anywhere; API carries integer cents.
- All "today" values come from the injectable `Clock` as a Pacific date (`America/Los_Angeles`); timestamps stored in UTC; `date` columns are read into `PacificDate` strings immediately.
- Migrations are additive only. No `DROP`, `TRUNCATE`, or column removal without an explicit `-- allow-destructive: <reason>` line reviewed by a human. The 7 unmigrated tables (`jersey_numbers`, `track_event_heats`, `track_event_programs`, `track_event_signups`, `track_event_teams`, `library_books`, `library_book_checkouts`) never appear in `schema.prisma`, and the runtime DB account has no privileges on them.
- Two DB accounts: `tocs_migrator` (DDL, deploy-time only) and `tocs_app` (DML only; INSERT-only on `audit_logs`).
- Sessions: server-side, cookie HttpOnly + Secure + SameSite=Lax; all non-GET requests need a CSRF header; API under `/api/v1`; only POST/PUT/PATCH/DELETE change data; every controller method declares `@RequirePermission(...)` or `@Public()` or the app fails to start.
- Error body `{ code, message, details, requestId }`; statuses: 401 unauthenticated, 403 no permission, 404 for "not yours", 422 validation, 409 conflict. Unknown request fields are rejected/dropped by DTO validation.
- Logs are structured and never contain card numbers, passwords, or tokens.
- Legacy password hash = `SHA256(password + salt)` hex, salt string used as stored; new hashes are argon2id in `users.password_hash_v2`; legacy columns stay until after the upgrade deadline (6 months after launch).
- Invitation token lifetime 3 days; password-reset token lifetime 6 hours; tokens are stored hashed, single-use.
- Mail From `engineering@to-cs.org` (old `Contacts::WEB_SITE_SUPPORT`), subjects prefixed `Thousand Oaks Chinese School - `.
- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Plan Decisions (defaults chosen in this plan, not fixed by the spec)

Reviewers: veto any of these and the plan changes with them.

- **D1** Forgot-password, forgot-username and "email already registered" responses never reveal whether a username/email exists (old system displayed usernames and "Username does not exist"). Forgot-username emails the usernames to the address on record.
- **D2** Login lockout: 5 consecutive failures for the same (lower-cased) username within 15 minutes → HTTP 429 `LOGIN_LOCKED` for 15 minutes; plus 20 requests/minute/IP on auth routes.
- **D3** New passwords (register, reset, change) must be ≥ 10 characters; legacy short passwords still log in.
- **D4** Session idle timeout 8 hours, absolute lifetime 7 days.
- **D5** School-year update allows editing `refund_90_percent_date` under the same "only while the stored date is empty or not in the past" rule as the other dates (old edit form omitted it, so it was uneditable after creation).
- **D6** Phone identity check (reset/invitation) compares digits only and accepts a leading country code `1` on 11-digit input.
- **D7** Requirements gap closed here: self-registration and forgot-username exist in the old system (`signin#register`, `signin#forgot_username`) but not in the requirements doc; they are added as FR-AUTH-09 / FR-AUTH-10 and implemented below.
- **D8** `GET /healthz` (outside `/api/v1`) is the health endpoint.

## Review Focus

Inputs the spec implies but no obvious test exercises; each has a pinning test in the named task.

1. Username typed with leading/trailing spaces ("alice ") must log in as "alice" (old code stripped it). → Task 8.
2. Phone numbers typed as "(805) 555-1234", "805.555.1234", "+1 805 555 1234" must match a stored 10-digit number. → Task 12.
3. Two simultaneous registrations with the same username must produce one account and one 409, never two accounts or a 500 (`users.username` has no unique index in the old schema). → Task 14.
4. No school year with `end_date >= today` (between years) must not crash lookups or `/me`. → Task 6.
5. Admin typing money as "19.99" must store exactly 1999 cents (old float code stored 1998). → Tasks 3, 19, 23.

## File Structure

```
backend/
  package.json  tsconfig.json  nest-cli.json  eslint.config.mjs  jest.config.ts  jest.int.config.ts
  db/baseline.sql                       # retained tables only, built from schema.rb + known drift
  prisma/schema.prisma  prisma/migrations/  prisma/seed.ts
  src/main.ts  src/app.module.ts
  src/config/env.ts
  src/common/{cents.ts, pacific-date.ts, clock.ts, problem.filter.ts, request-id.middleware.ts, redact.ts, logger.ts}
  src/prisma/prisma.service.ts
  src/school-year/{school-year.lookup.ts, school-year.service.ts, school-year.controller.ts, dto/*}
  src/audit/{audit.service.ts, audit.module.ts}
  src/auth/{password.service.ts, session.service.ts, session.guard.ts, csrf.guard.ts, login-throttle.service.ts,
            auth-token.service.ts, auth.controller.ts, registration.service.ts, account.service.ts, dto/*}
  src/access/{permission-codes.ts, permission.decorators.ts, permission.guard.ts, route-coverage.ts,
              permissions.service.ts, role-derivation.service.ts, roles.controller.ts, me.controller.ts}
  src/mail/{mail.service.ts, templates/*.txt}
  src/people/{validation.ts, phone.ts, people.service.ts, families.service.ts, policies.ts,
              self-service.controller.ts, staff.controller.ts, dto/*}
  src/curriculum/{grades.controller.ts, school-classes.service.ts, school-classes.controller.ts, dto/*}
  test/{helpers/*.ts, *.int-spec.ts}
frontend/   (Vite app: src/{api,auth,layout,pages/*,routes}, vitest setup, orval-free OpenAPI client script)
deploy/     Dockerfile.backend  Dockerfile.frontend  compose.dev.yml  compose.prod.yml  Caddyfile
            db/init-roles.sql  deploy.sh  backup.sh  restore.sh  ansible/{site.yml,roles/*}
scripts/    check-migrations.mjs  check-schema-drift.mjs  gen-api.mjs
.github/workflows/{ci.yml, deploy.yml}
```

---

## Part A — Foundations

### Task 1: Scaffolding, dev stack, health endpoint

**Files:**
- Create: `backend/*` (NestJS app, strict TS, Jest unit + integration configs), `frontend/*` (Vite React TS, Vitest), `deploy/compose.dev.yml` (PostgreSQL 16 on 5433, Mailpit), `.nvmrc`, root `.gitignore` additions (`node_modules`, `dist`, `.env*`, `coverage`), `backend/.env.example`.
- Test: `backend/test/health.int-spec.ts`, `frontend/src/App.test.tsx`.

**Interfaces:**
- Produces: `GET /healthz` → `200 {"status":"ok"}`; npm scripts in `backend`: `build`, `start:dev`, `lint`, `typecheck`, `test` (unit), `test:int` (integration); in `frontend`: `dev`, `build`, `lint`, `typecheck`, `test`.

- [ ] **Step 1: Write failing tests** — `health.int-spec.ts`: boots the Nest app, `GET /healthz` expects 200 and body `{status:'ok'}`. `App.test.tsx`: renders `<App/>` and expects text "Thousand Oaks Chinese School".
- [ ] **Step 2: Run to verify failure** — `cd backend && npm run test:int -- health` and `cd frontend && npm test` → FAIL (nothing exists).
- [ ] **Step 3: Scaffold** both apps with their official generators, then add the `/healthz` controller (excluded from the `/api/v1` global prefix) and the `App` component; strict TS everywhere; `compose.dev.yml` runs `postgres:16` and `axllent/mailpit`.
- [ ] **Step 4: Run tests** — both PASS; `npm run lint` and `npm run typecheck` pass in each app.
- [ ] **Step 5: Commit** — `git add backend frontend deploy .nvmrc .gitignore && git commit -m "chore: scaffold backend, frontend and dev stack"`.

### Task 2: Config, logging, request id, problem-JSON errors

**Files:**
- Create: `backend/src/config/env.ts`, `backend/src/common/{logger.ts, redact.ts, request-id.middleware.ts, problem.filter.ts}`, `backend/src/common/errors.ts`.
- Test: `backend/src/config/env.spec.ts`, `backend/src/common/redact.spec.ts`, `backend/test/problem.int-spec.ts`.

**Interfaces:**
- Produces: `loadEnv(source: Record<string,string|undefined>): Env` (zod-validated; fields `DATABASE_URL`, `DATABASE_MIGRATOR_URL`, `SESSION_SECRET`, `APP_BASE_URL` default `https://register.to-cs.org`, `SMTP_URL`, `MAIL_TRANSPORT: 'smtp'|'memory'`, `NODE_ENV`); `redact(value: unknown): unknown` masking keys matching `/pass(word)?|token|secret|card(number)?|cvv|authorization|cookie/i`; `class AppError extends Error { constructor(status: number, code: string, message: string, details?: unknown) }`; global filter producing `{code,message,details,requestId}`; every response carries `X-Request-Id`.

- [ ] **Step 1: Write failing tests** — `loadEnv({})` throws naming `DATABASE_URL`; `redact({password:'x',nested:{cardNumber:'4111',ok:1}})` → `{password:'[REDACTED]',nested:{cardNumber:'[REDACTED]',ok:1}}`; integration: a route throwing `new AppError(409,'X','m')` returns 409 with `code:'X'` and a `requestId` equal to the `X-Request-Id` header; an unhandled `Error` returns 500 `INTERNAL_ERROR` with no stack in the body.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the signatures above; logger is pino with `redact` applied to every logged object; request-id middleware honors an incoming `X-Request-Id` only if it matches `/^[A-Za-z0-9-]{8,64}$/`.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): env validation, redacting logger, problem-json errors`.

### Task 3: Shared value types — `Cents`, `PacificDate`, `Clock`

**Files:**
- Create: `backend/src/common/{cents.ts, pacific-date.ts, clock.ts}`, `backend/test/lint.spec.ts`; Modify: `backend/eslint.config.mjs`.
- Test: `backend/src/common/{cents.spec.ts, pacific-date.spec.ts, clock.spec.ts}`.

**Interfaces:**
- Produces:
  - `type Cents = number & { readonly __brand: 'Cents' }`; `cents(n: number): Cents` (throws `RangeError` unless `Number.isSafeInteger(n)`); `dollarsToCents(input: string): Cents` (accepts `^\d+(\.\d{1,2})?$` only, no floats); `formatCents(c: Cents): string` → `"$19.99"`.
  - `type PacificDate = string & { readonly __brand: 'PacificDate' }`; `pacificDate(s: string): PacificDate` (validates `YYYY-MM-DD` is a real date); `pacificDateFromUtc(d: Date): PacificDate`; `pacificDayToUtcRange(d: PacificDate): { start: Date; end: Date }` (half-open `[start,end)`); `addDays(d: PacificDate, n: number): PacificDate`; `comparePacific(a, b): number`; `fromDbDate(d: Date): PacificDate` and `toDbDate(p: PacificDate): Date` (UTC-midnight convention of Prisma `@db.Date`).
  - `abstract class Clock { abstract now(): Date; today(): PacificDate }`; `SystemClock`; `FixedClock(initial: Date)` with `set(d: Date)` and `advanceMs(ms: number)`.

- [ ] **Step 1: Write failing tests** —
  - `dollarsToCents('19.99') === 1999`, `'0.5' → 50`, `'20' → 2000`; throws on `'19.999'`, `'-1'`, `'1e3'`, `''`, `'abc'`; `cents(1.5)` throws.
  - `pacificDateFromUtc(new Date('2026-07-01T06:59:59Z')) === '2026-06-30'`; `'2026-07-01T07:00:00Z' → '2026-07-01'`; winter `'2026-01-01T07:59:59Z' → '2025-12-31'`, `'08:00:00Z' → '2026-01-01'`.
  - `pacificDayToUtcRange('2026-03-08')` spans exactly 23 h (start `2026-03-08T08:00:00.000Z`, end `2026-03-09T07:00:00.000Z`); `'2026-11-01'` spans 25 h (start `2026-11-01T07:00:00.000Z`, end `2026-11-02T08:00:00.000Z`); a normal day spans 24 h.
  - `pacificDate('2026-02-30')` throws; `addDays('2026-12-31', 1) === '2027-01-01'`; `fromDbDate(new Date('2026-05-01T00:00:00Z')) === '2026-05-01'`.
  - `new FixedClock(new Date('2026-07-01T06:59:59Z')).today() === '2026-06-30'` and after `advanceMs(1000)` is `'2026-07-01'`.
  - `lint.spec.ts`: ESLint Node API on a fixture containing `parseFloat('1')` and `(1).toFixed(2)` reports 2 `no-restricted-syntax` errors; the same code inside `src/common/cents.ts` is allowed.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** with `Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles'})` for date parts and a binary search over UTC instants (or two offset probes) for day boundaries; add the ESLint restriction banning `parseFloat` and `.toFixed` outside `src/common/cents.ts`.
- [ ] **Step 4: Run tests and `npm run lint`** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): Cents, PacificDate and Clock value types`.

### Task 4: Database baseline, Prisma schema, drift and duplicate checks

**Files:**
- Create: `backend/db/baseline.sql`, `backend/prisma/schema.prisma`, `backend/src/prisma/prisma.service.ts`, `backend/test/helpers/db.ts`, `scripts/check-schema-drift.mjs`.
- Test: `backend/test/schema.int-spec.ts`.

**Interfaces:**
- Produces: `PrismaService extends PrismaClient`; test helper `resetDatabase(): Promise<void>` (truncates all retained tables with `RESTART IDENTITY CASCADE`); `scripts/check-schema-drift.mjs <prod-schema.sql>` exits non-zero listing tables/columns present in one side only, plus a `--duplicates <db-url>` mode that reports duplicate `(family_id, child_id)`, `(right_id, role_id)`, `(role_id, user_id)` pairs.

- [ ] **Step 1: Write failing tests** — `schema.int-spec.ts`: (a) `schema.prisma` text contains none of the 7 unmigrated table names (`@@map` values); (b) for each retained table `prisma.<model>.findMany({take:1})` resolves; (c) models for `families_children`, `rights_roles`, `roles_users` declare `@@id` composite keys; (d) `school_years` has columns `early_registration_parent_and_student_class_fee_in_cents` and `student_fee_payments` has `elective_class_fee_in_cents` (both used by the Rails models but absent from `schema.rb`).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Build `baseline.sql`** from `chineseschool/db/schema.rb` for the 29 retained tables (drop the 7 unmigrated ones), then add the two drifted columns above with `NOT NULL DEFAULT 0` and a `-- verify against production` comment; load it into the dev/test database, run `prisma db pull`, then hand-edit the pulled schema: camelCase fields with `@map`, `@@map` snake_case tables, composite `@@id` on the three join tables (no DB constraint is added), explicit `@relation` names for `parent_one_id/parent_two_id`, `paid_by_id`, `recorded_by_id`, etc.; write `scripts/check-schema-drift.mjs`.
- [ ] **Step 4: Run tests** — PASS. Run the duplicates mode against the dev DB (expect none).
- [ ] **Step 5: Commit** — `feat(backend): database baseline and Prisma schema`.

> **Note for the executor:** `schema.rb` is not authoritative (DATA-05). Once a sanitized production schema dump exists, run `node scripts/check-schema-drift.mjs <dump>` and fix `baseline.sql`/`schema.prisma` before any release.

### Task 5: Additive migrations, DB roles, migration safety check

**Files:**
- Create: `backend/prisma/migrations/<ts>_foundation/migration.sql`, `deploy/db/init-roles.sql`, `scripts/check-migrations.mjs`; Modify: `backend/prisma/schema.prisma`, `deploy/compose.dev.yml`.
- Test: `scripts/check-migrations.test.mjs` (node:test), `backend/test/db-roles.int-spec.ts`.

**Interfaces:**
- Produces tables: `sessions(id bigserial, token_hash text unique, user_id int, created_at, last_seen_at, expires_at, ip text, user_agent text)`, `auth_tokens(id, token_hash text unique, purpose text, person_id int, expires_at, used_at null, created_at)`, `permissions(id, code text unique, description text)`, `role_permissions(role_id, permission_id, primary key both)`, `audit_logs(id bigserial, occurred_at timestamptz default now(), actor_user_id int null, actor_username text null, action text, target_type text null, target_id text null, ip text null, meta jsonb default '{}')`; column `users.password_hash_v2 text null`.
- `check-migrations.mjs <dir>` exits 1 if any migration SQL contains `DROP `, `TRUNCATE`, `ALTER TABLE … DROP COLUMN`, `RENAME`, unless the same statement is preceded by a `-- allow-destructive: <reason>` line.
- DB roles: `tocs_migrator` owns the schema; `tocs_app` has SELECT/INSERT/UPDATE/DELETE on retained tables and sequences, only SELECT/INSERT on `audit_logs`, no DDL, no access to any of the 7 unmigrated tables.

- [ ] **Step 1: Write failing tests** — `check-migrations.test.mjs`: fixture with `DROP TABLE x;` fails; same with the allow comment passes; `CREATE TABLE`/`ADD COLUMN`/`CREATE INDEX` pass. `db-roles.int-spec.ts` (connects as `tocs_app`): `UPDATE audit_logs …` and `DELETE FROM audit_logs` fail with permission denied; `INSERT INTO audit_logs` succeeds; `CREATE TABLE t(x int)` fails; `SELECT` from `users` succeeds.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the migration (via `prisma migrate dev --create-only` then review the SQL), `init-roles.sql` (run by compose on first start), and the checker; make the app read `DATABASE_URL` (app account) and Prisma CLI use `DATABASE_MIGRATOR_URL`.
- [ ] **Step 4: Run tests** — PASS; `node scripts/check-migrations.mjs backend/prisma/migrations` passes.
- [ ] **Step 5: Commit** — `feat(backend): additive auth/audit tables, db roles, migration safety check`.

### Task 6: School-year lookups

**Files:**
- Create: `backend/src/school-year/school-year.lookup.ts`.
- Test: `backend/test/school-year-lookup.int-spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `Clock`.
- Produces: `class SchoolYearLookup { current(): Promise<SchoolYearRow|null>; next(): Promise<SchoolYearRow|null>; newest(): Promise<SchoolYearRow|null>; currentAndFuture(): Promise<SchoolYearRow[]>; activeForRegistration(): Promise<SchoolYearRow[]>; activeForRefund(): Promise<SchoolYearRow[]>; hasStarted(y: SchoolYearRow): boolean }`. `SchoolYearRow` has `PacificDate` date fields and `Cents` money fields.

- [ ] **Step 1: Write failing tests** (frozen `FixedClock`, years A 2025-09-01..2026-06-15, B 2026-09-01..2027-06-15, C 2027-09-01..2028-06-15): `current()` is A on 2026-06-15 (end_date ≥ today, inclusive) and B on 2026-06-16; `next()` is the one after `current()`; `newest()` returns the latest-ending year with `end_date >= today`; on 2028-06-16 (all ended) `current()`, `next()`, `newest()` return `null` and `currentAndFuture()` is `[]` (Review Focus 4); `activeForRegistration()` includes a year iff `early_registration_start_date <= today <= registration_end_date`; `activeForRefund()` iff `refund_end_date >= today`; `hasStarted` is `today >= start_date`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** with Prisma queries ordered by `start_date asc`, mapping `date` columns through `fromDbDate` and `*_in_cents` through `cents`.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): school-year lookups`.

---

## Part B — Auth, access, audit

### Task 7: Audit service

**Files:**
- Create: `backend/src/audit/{audit.service.ts, audit.module.ts}`.
- Test: `backend/test/audit.int-spec.ts`.

**Interfaces:**
- Produces: `AuditService.record(e: { action: string; actorUserId?: number; actorUsername?: string; targetType?: string; targetId?: string | number; ip?: string; meta?: Record<string, unknown> }): Promise<void>` (global module; `meta` passes through `redact`); `AuditService.countRecentFailures(username: string, sinceMs: number): Promise<number>` (failures after the latest `auth.login_succeeded` for that username).

- [ ] **Step 1: Write failing tests** — a recorded event is stored with `occurred_at` set; `meta:{password:'x',reason:'y'}` is stored as `{password:'[REDACTED]',reason:'y'}`; `countRecentFailures('Bob', 15*60_000)` counts `auth.login_failed` rows for `bob` (case-insensitive) newer than the cutoff and resets to 0 after an `auth.login_succeeded` row.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (store `actor_username` lower-cased; the failure counter is a single SQL query).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): audit log service`.

### Task 8: PasswordService, sessions, login/logout, CSRF, throttling

**Files:**
- Create: `backend/src/auth/{password.service.ts, session.service.ts, session.guard.ts, csrf.guard.ts, login-throttle.service.ts, auth.controller.ts, dto/login.dto.ts}`.
- Test: `backend/src/auth/password.service.spec.ts`, `backend/test/auth-login.int-spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `AuditService`, `Clock`.
- Produces:
  - `PasswordService.verify(plain: string, user: { passwordHashV2: string|null; passwordHash: string|null; passwordSalt: string|null }): Promise<{ ok: boolean; needsUpgrade: boolean }>`; `hash(plain: string): Promise<string>` (argon2id); `assertPolicy(plain: string): void` (throws `AppError(422,'PASSWORD_TOO_SHORT',…)` when `< 10` characters); `legacyHash(plain: string, salt: string): string`.
  - `SessionService.create(userId: number, meta: {ip?: string; userAgent?: string}): Promise<{ id: string; expiresAt: Date }>`, `resolve(rawId: string): Promise<{ userId: number }|null>` (idle 8 h, absolute 7 d, slides `last_seen_at`), `destroy(rawId: string)`, `destroyAllForUser(userId: number)`. Session ids are 32 random bytes base64url; only their SHA-256 is stored.
  - HTTP: `GET /api/v1/auth/csrf` (sets cookie `tocs_csrf`, returns `{token}`); `POST /api/v1/auth/login {username,password}` → 200 `{ userId }` + cookie `tocs_session`; `POST /api/v1/auth/logout` → 204. Global `SessionGuard` fills `req.user = {id, personId, username}`; `CsrfGuard` requires header `X-CSRF-Token` equal to the `tocs_csrf` cookie on every non-GET request.

- [ ] **Step 1: Write failing tests** —
  - unit: `legacyHash('secret1','abcdefgh') === '914727a8b6364a21cd6cc46e4e4d2142e24ededdf404611d60fd99834be3e7d0'`; `legacyHash('Pa55word!x','/ab+c=') === '972b0585dcc05a98d22da9509125f971e5d837384436fa50c5e9ee341357b532'`; `verify` with only legacy columns and correct password → `{ok:true, needsUpgrade:true}`; with a v2 hash → `needsUpgrade:false`; wrong password → `ok:false`; user with NULL/blank hash and salt → `{ok:false}` without throwing; `assertPolicy('123456789')` throws, `assertPolicy('1234567890')` passes.
  - integration: login with a legacy user succeeds (200, `Set-Cookie` has `HttpOnly; Secure; SameSite=Lax`), then `users.password_hash_v2` is populated and `password_hash`/`password_salt` are unchanged, and an `auth.login_succeeded` audit row exists; `"  alice "` logs in as `alice` (Review Focus 1); wrong password and unknown username both return 401 `INVALID_CREDENTIALS` with identical bodies; 5 failures then the correct password → 429 `LOGIN_LOCKED`; a non-GET without the CSRF header → 403 `CSRF_INVALID`; after logout the cookie no longer resolves (401 on a protected route); a session idle for 8 h+1 s (advance `FixedClock`) is rejected.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the signatures; for unknown usernames run `verify` against a fixed dummy argon2 hash to keep timing similar; `LoginThrottleService.assertAllowed(username: string): Promise<void>` uses `AuditService.countRecentFailures(username, 15*60_000) >= 5`; add `@nestjs/throttler` at 20/min/IP on `/auth/*`; trim the username before lookup (case-sensitive match as in the old system).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): password verification with legacy upgrade, sessions, login throttling, CSRF`.

### Task 9: Permission codes, guards, route coverage, seed, `/me`

**Files:**
- Create: `backend/src/access/{permission-codes.ts, permission.decorators.ts, permission.guard.ts, route-coverage.ts, permissions.service.ts, me.controller.ts}`, `backend/prisma/seed.ts`; Modify: `backend/src/main.ts`, `backend/src/app.module.ts`.
- Test: `backend/test/access.int-spec.ts`.

**Interfaces:**
- Produces:
  - `PERMISSION_CODES` (const tuple) and `type PermissionCode`: `access.roles.read`, `access.roles.manage_users`, `access.permissions.read`, `auth.invitations.create`, `people.read`, `people.edit`, `people.address.create`, `people.address.edit`, `families.read`, `families.create`, `families.address.edit`, `families.parent.add`, `families.child.add`, `family.self.address.edit`, `family.self.parent.add`, `family.self.child.add`, `person.self.edit`, `person.self.address.create`, `person.self.address.edit`, `school_years.read`, `school_years.create`, `school_years.edit`, `school_years.book_charges.edit`, `school_years.auto_class_assignment.toggle`, `grades.read`, `school_classes.read`, `school_classes.create`, `school_classes.edit`, `school_classes.toggle_active`, `home.panel.principal`, `home.panel.academic_vice_principal`, `home.panel.registration_officer`, `home.panel.accounting_officer`, `home.panel.activity_officer`, `home.panel.communication_officer`, `home.panel.instruction_officer`, `home.panel.instructor`, `home.panel.pva`, `home.panel.student_parent`.
  - `@RequirePermission(code: PermissionCode)`, `@Public()`, `@Authenticated()` (requires a session, no permission code); global `PermissionGuard` (runs after `SessionGuard`): unauthenticated → 401, role `Super User` → allowed, else the user's roles must grant the code → 403 `FORBIDDEN`.
  - `assertRouteCoverage(app: INestApplication): void` throws `Error` listing every route handler lacking `@RequirePermission`/`@Public`/`@Authenticated`; called from `main.ts` before `listen` and from a test.
  - `PermissionsService.forUser(userId: number): Promise<{ roles: string[]; permissions: PermissionCode[] }>` (Super User → all codes).
  - `GET /api/v1/me` → `{ user: {id, username}, person: {id, englishName, chineseName}, roles, permissions }`.
  - `prisma/seed.ts` (idempotent): upserts roles (`Super User`, `Principal`, `Academic Vice Principal`, `Registration Officer`, `Accounting Officer`, `Activity Officer`, `Communication Officer`, `Instruction Officer`, `Instructor`, `Room Parent`, `Student Parent`, `CCCA Staff`, `PVA`), upserts all permission rows, and grants per the legacy `db/seeds.rb`: **Registration Officer** gets `people.*`, `families.*`, `school_years.*`, `grades.read`, `school_classes.*` and its panel; **Student Parent** gets the six `*.self.*` codes and `home.panel.student_parent`; each other role gets only its own `home.panel.*` (`Instructor` and `Room Parent` both get `home.panel.instructor`). `access.*` and `auth.invitations.create` are granted to no role: in the old system only Super User reached `admin/roles`, `admin/rights` and `admin/user_registration`.

- [ ] **Step 1: Write failing tests** — a test controller with an undecorated route makes `assertRouteCoverage` throw naming it; Super User reaches a `school_years.read` route without any grant; a Registration Officer user reaches it, a Student Parent gets 403, anonymous gets 401; `/me` for a Student Parent returns exactly the Student Parent permission set; seeding twice leaves row counts unchanged.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** using Nest metadata (`Reflector`) and `DiscoveryService`/router explorer for coverage; seed script uses Prisma upserts and is run by `npm run seed`.
- [ ] **Step 4: Run tests** — PASS; `npm run start:dev` boots only when every route is annotated.
- [ ] **Step 5: Commit** — `feat(backend): default-deny permissions, route coverage check, seed, /me`.

### Task 10: Roles administration API

**Files:**
- Create: `backend/src/access/roles.controller.ts`.
- Test: `backend/test/roles.int-spec.ts`.

**Interfaces:**
- Consumes: `AuditService`, `@RequirePermission`.
- Produces (all under `/api/v1`): `GET /roles` (`access.roles.read`) → `[{id,name,userCount}]`; `GET /roles/:id` → `{id,name,permissions:string[],users:[{id,username,personName}]}`; `POST /roles/:id/users {username}` (`access.roles.manage_users`) → 204; `DELETE /roles/:id/users/:userId` → 204; `GET /permissions` (`access.permissions.read`) → `[{code,description,roles:string[]}]`.

- [ ] **Step 1: Write failing tests** — Super User lists roles; adding an unknown username → 404 `USER_NOT_FOUND`; adding the same user twice leaves exactly one `roles_users` row (old code duplicated it) and both calls return 204; removing a user who lacks the role is 204 and a no-op; add/remove each write an `access.role_user_added` / `access.role_user_removed` audit row with the role id and user id; a Registration Officer gets 403 on every endpoint.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): roles administration API`.

### Task 11: Auth tokens and mail

**Files:**
- Create: `backend/src/auth/auth-token.service.ts`, `backend/src/mail/{mail.service.ts, templates/account_invitation.txt, templates/password_reset.txt, templates/username_reminder.txt}`.
- Test: `backend/test/auth-token.int-spec.ts`, `backend/src/mail/mail.service.spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `Clock`.
- Produces: `type TokenPurpose = 'invitation' | 'password_reset'`; `AuthTokenService.issue(purpose, personId: number): Promise<{ token: string; expiresAt: Date }>` (32 random bytes base64url; stores SHA-256 hex; lifetimes 3 days / 6 hours); `peek(purpose, token): Promise<{ personId: number }>` and `consume(purpose, token): Promise<{ personId: number }>` throw `AppError(404,'INVALID_TOKEN',…)` for unknown, expired, used, or wrong-purpose tokens; `consume` sets `used_at`. `MailService.send(template: 'account_invitation'|'password_reset'|'username_reminder', to: string, vars: Record<string,string>): Promise<void>`; `MAIL_TRANSPORT=memory` keeps messages in `MailService.outbox: {to,subject,text}[]`.

- [ ] **Step 1: Write failing tests** — the stored value differs from the issued token and equals its SHA-256; `peek` twice succeeds, `consume` twice fails the second time; an invitation token is valid at +71 h and invalid at +73 h, a reset token valid at +5 h and invalid at +7 h (advance `FixedClock`); a reset token used as `invitation` fails; rendered subjects are exactly `Thousand Oaks Chinese School - Account Invitation`, `Thousand Oaks Chinese School - Password Reset`, `Thousand Oaks Chinese School - Username Reminder`; From is `engineering@to-cs.org`; the invitation body contains `${APP_BASE_URL}/register-with-invitation/<token>` and the text "72 hours"; the reset body contains `${APP_BASE_URL}/reset-password/<token>` and "6 hours".
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**; templates reuse the wording of `chineseschool/app/views/signin_mailer/{account_invitation,forgot_password}.text.erb` with `{{name}}` / `{{link}}` placeholders; `username_reminder.txt` lists usernames and the sign-in URL.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): hashed single-use auth tokens and mail templates`.

### Task 12: Invitations and register-with-invitation (+ role derivation, phone check)

**Files:**
- Create: `backend/src/people/phone.ts`, `backend/src/access/role-derivation.service.ts`, `backend/src/auth/registration.service.ts`, `backend/src/auth/admin-invitations.controller.ts`, `backend/src/auth/dto/{create-invitation.dto.ts, register-with-invitation.dto.ts}`; Modify: `backend/src/auth/auth.controller.ts` (public invitation routes).
- Test: `backend/src/people/phone.spec.ts`, `backend/test/invitation.int-spec.ts`, `backend/test/role-derivation.int-spec.ts`.

**Interfaces:**
- Consumes: `AuthTokenService`, `MailService`, `PasswordService`, `SchoolYearLookup`, `AuditService`.
- Produces:
  - `cleanPhone(input: string): string` (digits only; if 11 digits starting with `1`, drop the `1`); `phoneMatchesPerson(personId: number, input: string): Promise<boolean>` — if the person has `address_id`, compare against that address's `home_phone`/`cell_phone`; otherwise against any address of the families where the person is a parent or a child (old `Person#phone_number_correct?`).
  - `RoleDerivationService.adjust(userId: number): Promise<void>` — removes then re-adds `Instructor`/`Room Parent` roles from the person's `instructor_assignments` in `SchoolYearLookup.current()` (role `Primary Instructor` or `Secondary Instructor` → `Instructor`; `Room Parent` → `Room Parent`; `Teaching Assistant` → none); no current year → removes both roles.
  - `POST /admin/user-registration/invitations {personId, emailDestination}` (`auth.invitations.create`) → 201; 404 `PERSON_NOT_FOUND`, 409 `PERSON_ALREADY_HAS_ACCOUNT`, 422 `EMAIL_REQUIRED`; sends the invitation mail; audit `auth.invitation_sent`.
  - `GET /auth/invitations/:token` (`@Public`) → 200 `{ personName }` or 404 `INVALID_TOKEN`.
  - `POST /auth/register-with-invitation {token, username, password, passwordConfirmation, phoneNumber}` (`@Public`) → 201.

- [ ] **Step 1: Write failing tests** — `cleanPhone`: `'(805) 555-1234'`, `'805.555.1234'`, `'+1 805 555 1234'` all → `'8055551234'`, `'805-555-123'` stays 9 digits (Review Focus 2); invitation to a person who already has a user → 409; empty `emailDestination` → 422; register: mismatching confirmation → 422 `PASSWORD_MISMATCH`, wrong phone → 422 `PHONE_MISMATCH`, short password → 422 `PASSWORD_TOO_SHORT`, a person who already has an account → 409 `ACCOUNT_EXISTS` whose body does **not** contain the existing username (D1), success creates the user with `Student Parent` (plus `Instructor` when the person has a current-year primary-instructor assignment), consumes the token (reuse → 404), and writes `auth.account_created`; `RoleDerivationService.adjust` cases: primary instructor → `Instructor` only; room parent → `Room Parent` only; teaching assistant → neither; assignment in a non-current year → neither; no current school year → neither, no throw.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**; the registration writes user, role rows and token consumption in one Prisma transaction; usernames are trimmed and must be non-blank.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): account invitations, phone identity check, role derivation`.

### Task 13: Forgot password, reset password, forgot username

**Files:**
- Create: `backend/src/auth/account.service.ts`, `backend/src/auth/dto/{forgot-password.dto.ts, reset-password.dto.ts, forgot-username.dto.ts}`; Modify: `backend/src/auth/auth.controller.ts`.
- Test: `backend/test/account-recovery.int-spec.ts`.

**Interfaces:**
- Consumes: `AuthTokenService`, `MailService`, `PasswordService`, `phoneMatchesPerson`, `SessionService`.
- Produces: `POST /auth/forgot-password {username}` → always 202 `{}`; `GET /auth/reset-tokens/:token` → 200 or 404 `INVALID_TOKEN`; `POST /auth/reset-password {token, password, passwordConfirmation, phoneNumber}` → 204; `POST /auth/forgot-username {email}` → always 202 `{}`. All `@Public`.

- [ ] **Step 1: Write failing tests** — forgot-password for an unknown username, and for a user whose person has no email address, returns the same 202 and sends nothing (D1); for a valid user it sends one reset mail to `person.personalEmailAddress` (own address email, else the first family address with a non-blank email); reset: wrong phone → 422 `PHONE_MISMATCH`, mismatched confirmation → 422, short password → 422, success sets `password_hash_v2`, leaves legacy columns untouched, destroys all of the user's sessions, consumes the token (second use 404) and audits `auth.password_reset`; forgot-username: matching addresses (the address of a person with an account, or of a family whose parents have accounts) get one `username_reminder` mail listing the usernames, unknown email → same 202, nothing sent; the response body never contains a username.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** (email resolution mirrors `Person#personal_email_address`; username lookup mirrors `signin#forgot_username`).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): password recovery and username reminder`.

### Task 14: Self-registration and change password

**Files:**
- Create: `backend/src/people/validation.ts`, `backend/src/auth/dto/{register.dto.ts, change-password.dto.ts}`, `backend/src/auth/me-password.controller.ts`; Modify: `backend/src/auth/{registration.service.ts, auth.controller.ts}`.
- Test: `backend/src/people/validation.spec.ts`, `backend/test/self-registration.int-spec.ts`.

**Interfaces:**
- Produces (used again by Task 15):
  - `validatePersonInput(input, opts: { isChild: boolean }): ValidationErrors` — required `gender` (`'M'|'F'`), `englishFirstName`, `englishLastName` (≤ 255 chars); for children also `birthYear` and `birthMonth`; `birthYear` integer `> 1900` and `< current year` (year from `Clock`), `birthMonth` integer 1..12.
  - `validateAddressInput(input): ValidationErrors` — required `street, city, state, zipcode, homePhone, email`; `zipcode` integer string `< 100000`; `homePhone` must clean to exactly 10 digits (stored as digits); `formatPhone(digits: string): string` → `(805) 555-1234`.
- Produces: `POST /auth/register {address:{street,city,state,zipcode,homePhone,cellPhone?,email}, parentOne:{englishFirstName,englishLastName,chineseName?,gender,nativeLanguage?}, username, password, passwordConfirmation}` (`@Public`) → 201; 409 `EMAIL_ALREADY_REGISTERED` (no usernames in the body); `POST /me/password {currentPassword, newPassword, newPasswordConfirmation}` (authenticated, no extra permission → decorate `@Public()`-like `@Authenticated()` helper defined in `permission.decorators.ts`) → 204.

- [ ] **Step 1: Write failing tests** — validation: a child without birth data → errors on both fields; `birthYear` 1900 and the current year → invalid, 1901 valid; month 0 and 13 invalid; zipcode `'93012'` valid, `'100000'` and `'9301a'` invalid; home phone `'805-555-123'` invalid, `'(805) 555-1234'` valid and stored as `8055551234`; registration: success creates one address, one person (parent one), one family (`parent_one_id`, `address_id`), one user with `Student Parent`, all or nothing (a forced failure after the family insert leaves none); an address email that already exists on any address → 409 `EMAIL_ALREADY_REGISTERED`; password confirmation mismatch → 422; **two concurrent registrations with the same username** (`Promise.all`) → exactly one 201 and one 409 `USERNAME_TAKEN`, one `users` row (Review Focus 3; serialize with `pg_advisory_xact_lock(hashtext('username:' || lower($1)))`); change password: wrong current password → 422 `CURRENT_PASSWORD_INVALID`, mismatch → 422, short → 422, success updates `password_hash_v2`, keeps the current session, destroys the user's other sessions, audits `auth.password_changed`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): self-registration and change password`.

---

## Part C — Domain modules

### Task 15: People, address and family domain

**Files:**
- Create: `backend/src/people/{people.service.ts, families.service.ts, dto/*.ts}`.
- Test: `backend/test/people-service.int-spec.ts`.

**Interfaces:**
- Consumes: `PrismaService`, `validatePersonInput`/`validateAddressInput`/`formatPhone` (Task 14).
- Produces:
  - `PeopleService`: `get(id)`, `search({query?: string; page: number; pageSize: number}): Promise<{items; total}>` (case-insensitive match on English first/last name and Chinese name, ordered last, first), `update(id, input)`, `createPersonalAddress(personId, input)`, `updatePersonalAddress(personId, input)`.
  - `FamiliesService`: `get(id)` (parents, children, address), `create({address, parentOne})`, `updateAddress(familyId, input)`, `addParentTwo(familyId, input)` (409 `PARENT_TWO_EXISTS` if already set — old code overwrote silently), `addChild(familyId, input)`; `create` and `addChild` run in one transaction; `personIsParentOf(personId, childId): Promise<boolean>`; `personIsParentInFamily(personId, familyId): Promise<boolean>`.

- [ ] **Step 1: Write failing tests** — person with Chinese name `'陈小明'` and an apostrophe/hyphen English name round-trips unchanged through `update`/`get`; search by `'chen'` and by `'陈'` finds the person; `addParentTwo` twice → 409; `create` family with invalid address stores nothing; `personIsParentOf` is true for parent one and parent two, false for an unrelated person.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement**; DTOs delegate to the Task 14 validators; address/person output DTOs expose `homePhone`/`cellPhone` formatted.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): people, address and family domain services`.

### Task 16: Parent self-service API (object-level policies)

**Files:**
- Create: `backend/src/people/{policies.ts, self-service.controller.ts}`.
- Test: `backend/test/self-service.int-spec.ts`.

**Interfaces:**
- Consumes: `FamiliesService`, `PeopleService`, `@RequirePermission`.
- Produces: `FamilyAccessPolicy.assertParentOf(userPersonId: number, familyId: number): Promise<void>` (throws 404 `NOT_FOUND` when the user is neither `parent_one` nor `parent_two`); `PersonAccessPolicy.assertSelfOrParent(userPersonId: number, personId: number): Promise<void>`. Routes (`/api/v1/me/...`): `GET /me/families` → the user's families (as parent) with children; `PATCH /me/families/:id/address` (`family.self.address.edit`); `POST /me/families/:id/parents` (`family.self.parent.add`); `POST /me/families/:id/children` (`family.self.child.add`); `PATCH /me/people/:id` (`person.self.edit`); `POST /me/people/:id/address` (`person.self.address.create`); `PATCH /me/people/:id/address` (`person.self.address.edit`). The `person.self.address.create` default address source is the person's first family address as in the old form.

- [ ] **Step 1: Write failing tests** (IDOR matrix) — parent A updates family A address → 204; parent A on family B → 404 for every one of the five family/person mutations and for `GET`; parent A edits own record and own child → 204, another family's child → 404, a child of the *other* parent in the same family → 204 (both parents of a family are authorized); a Registration Officer without `family.self.*` gets 403 here (staff use Task 17 routes); creating a personal address then editing it persists; editing without an address → 404 `NO_PERSONAL_ADDRESS`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** policies as injectable services called first in each handler; map `AppError(404)` for denial.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): parent self-service family and person endpoints`.

### Task 17: Registration-officer people and family API

**Files:**
- Create: `backend/src/people/staff.controller.ts`.
- Test: `backend/test/staff-people.int-spec.ts`.

**Interfaces:**
- Produces (`/api/v1`): `GET /people?query=&page=&pageSize=` (`people.read`; `pageSize` ≤ 100, default 25) → `{items,total}`; `GET /people/:id` (`people.read`) → person with address, families, class-assignment-free basics; `PATCH /people/:id` (`people.edit`); `POST /people/:id/address` (`people.address.create`); `PATCH /people/:id/address` (`people.address.edit`); `GET /families/:id` (`families.read`); `POST /families` (`families.create`, body `{address,parentOne}`) → 201 `{id}`; `PATCH /families/:id/address` (`families.address.edit`); `POST /families/:id/parents` (`families.parent.add`); `POST /families/:id/children` (`families.child.add`).

- [ ] **Step 1: Write failing tests** — Registration Officer can search/show/edit any person and create a family; a Student Parent gets 403 on all of them; `pageSize=1000` is clamped to 100; 422 bodies list field errors keyed by field name; every mutation writes no audit (not required) but returns the updated resource.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** by delegating to the Task 15 services.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): registration officer people and family endpoints`.

### Task 18: School-year administration

**Files:**
- Create: `backend/src/school-year/{school-year.service.ts, school-year.controller.ts, dto/*.ts}`.
- Test: `backend/src/school-year/school-year.rules.spec.ts`, `backend/test/school-year-admin.int-spec.ts`.

**Interfaces:**
- Consumes: `SchoolYearLookup`, `Clock`, `Cents`/`PacificDate`.
- Produces: `SchoolYearService.list()`, `get(id)`, `create(input)`, `update(id, input)`, `toggleAutoClassAssignment(id)`; `validateSchoolYear(input): ValidationErrors` — required fields as in `school_year.rb`; `startDate <= endDate`; `registrationFee`, `earlyRegistrationTuition`, `tuition`, `electiveClassFee`, `tuitionDiscountForThreeOrMoreChild`, `pvaMembershipDue`, `cccaMembershipDue`, `parentAndStudentClassFee`, `earlyRegistrationParentAndStudentClassFee` are integers `> 0`; `tuitionDiscountForPreK` and `tuitionDiscountForInstructor` integers `>= 0`; all money fields are integer cents. `applyDateEdits(existing, requested, today): dates` — a date field is replaced only when the stored value is empty or `>= today`. Routes (`/api/v1/school-years`): `GET /` (`school_years.read`), `GET /:id`, `POST /` (`school_years.create`), `PATCH /:id` (`school_years.edit`), `POST /:id/auto-class-assignment/toggle` (`school_years.auto_class_assignment.toggle`). The legacy columns `registration_50_percent_date`, `refund_75_percent_date`, `refund_25_percent_date` are neither read nor written (left NULL on new rows).

- [ ] **Step 1: Write failing tests** — rules: start after end → error on `startDate`; `tuition: 0` → error, `tuitionDiscountForPreK: 0` valid; `applyDateEdits` with today `2026-11-02`: stored `2026-10-01` (past) is kept, stored `2026-11-02` is replaced, stored `null` is set; `refund90PercentDate` follows the same rule (D5). Integration: `list` ordered by start date ascending; `create` sets `previous_school_year_id` to the latest year whose `end_date <= newStart`, creates a `school_class_active_flags` row (`active=true`) for **every** existing class and a `book_charges` row of 2000 cents for **every** grade, all in one transaction (forced failure leaves no year); `update` of fees applies even for past years while past dates stay frozen; `toggleAutoClassAssignment` flips the flag twice back to the original value; Registration Officer allowed, Student Parent 403.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** with money fields as `Cents` in DTOs (integers in JSON).
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): school year administration`.

### Task 19: Book charges, grades and school classes

**Files:**
- Create: `backend/src/curriculum/{grades.controller.ts, school-classes.service.ts, school-classes.controller.ts, dto/*.ts}`; Modify: `backend/src/school-year/{school-year.service.ts, school-year.controller.ts}` (book charges).
- Test: `backend/test/book-charges.int-spec.ts`, `backend/test/school-classes.int-spec.ts`.

**Interfaces:**
- Produces:
  - `GET /school-years/:id/book-charges` (`school_years.read`) → `[{id, gradeId, gradeName, bookChargeInCents}]` ordered by `grade_id`; `PUT /school-years/:id/book-charges` (`school_years.book_charges.edit`, body `[{id, bookChargeInCents}]`) — all-or-nothing, each `>= 0` integer.
  - `GET /grades` (`grades.read`) → grades with `nextGradeId`, ordered following the `next_grade` chain from `short_name = 'Pre'`.
  - `SCHOOL_CLASS_TYPES = ['S','T','M','SE','ELECTIVE','EC','ECPS']` (same list as the old model). `GET /school-classes` (`school_classes.read`) → classes sorted by English name with `activeCurrent`/`activeNext` flags for `SchoolYearLookup.current()/next()` (false when the year is `null`); `POST /school-classes` (`school_classes.create`); `PATCH /school-classes/:id` (`school_classes.edit`); `PUT /school-classes/:id/active {schoolYearId, active}` (`school_classes.toggle_active`) creating the flag row when missing.
  - `validateSchoolClass(input)`: `englishName`, `chineseName`, `schoolClassType` (in the list) required; names unique across classes (409 `NAME_TAKEN`); `maxSize` integer `> 0` (default 25); `minAge`/`maxAge` integers `>= 0` or null; `gradeId` optional.

- [ ] **Step 1: Write failing tests** — book charges: body `[{id:1,bookChargeInCents:1999}]` reads back exactly 1999 (Review Focus 5), a non-integer `1999.5` → 422, and a batch containing one negative value → 422 with no row changed; grades follow the chain Pre → K → 1 …; classes: creating a class makes `active=true` flags for each of `currentAndFuture()` years; duplicate English or Chinese name → 409; `maxSize: 0` → 422; type `'XX'` → 422; toggling a class for a year with no flag row creates it; `activeCurrent`/`activeNext` are false when no current year exists.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(backend): book charges, grades and school classes`.

---

## Part D — Front end

### Task 20: Front-end foundation (API client, auth context, router, layout)

**Files:**
- Create: `scripts/gen-api.mjs`, `frontend/src/api/{client.ts, generated/.gitkeep}`, `frontend/src/auth/{AuthProvider.tsx, useMe.ts, RequirePermission.tsx}`, `frontend/src/layout/AppLayout.tsx`, `frontend/src/routes/index.tsx`, `frontend/src/test/{setup.ts, server.ts}`, `backend/src/openapi.ts`; Modify: `backend/src/main.ts` (Swagger at `/api/v1/openapi.json`).
- Test: `frontend/src/auth/auth.test.tsx`.

**Interfaces:**
- Produces: `npm run gen:api` (writes `frontend/src/api/generated/schema.d.ts` from the backend OpenAPI via `openapi-typescript`; CI fails if `git diff --exit-code` shows changes); `apiFetch(path: string, init?: RequestInit): Promise<Response>` that sends credentials, fetches/stores the CSRF token and adds `X-CSRF-Token` on non-GET, and on 401 navigates to `/signin?returnTo=<current path>`; `useMe(): { me: Me|null; loading: boolean; can(code: string): boolean }`; `<RequirePermission code="...">` hides children when `can` is false; route groups `/parent`, `/registration`, `/accounting`, `/admin`, `/instruction`, `/communication` plus public routes (`/signin`, `/register`, `/forgot-password`, `/forgot-username`, `/reset-password/:token`, `/register-with-invitation/:token`).

- [ ] **Step 1: Write failing tests** (Vitest + Testing Library + MSW) — a protected route with `/api/v1/me` returning 401 redirects to `/signin?returnTo=%2Fadmin%2Fschool-years`; after a successful login MSW call the app navigates to the `returnTo` path; a POST sends `X-CSRF-Token` equal to the token returned by `/api/v1/auth/csrf`; `<RequirePermission code="school_years.read">` renders its child only when `/me` lists the code.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the signatures; Ant Design `ConfigProvider` with English locale; layout menu built from `can(...)`.
- [ ] **Step 4: Run tests, `npm run gen:api`, `npm run typecheck`** — PASS, no diff after regeneration.
- [ ] **Step 5: Commit** — `feat(frontend): api client, auth context, routing and layout`.

### Task 21: Public authentication pages

**Files:**
- Create: `frontend/src/pages/public/{SignInPage.tsx, RegisterPage.tsx, ForgotPasswordPage.tsx, ForgotUsernamePage.tsx, ResetPasswordPage.tsx, RegisterWithInvitationPage.tsx}`, `frontend/src/pages/account/ChangePasswordPage.tsx`.
- Test: `frontend/src/pages/public/public-pages.test.tsx`.

**Interfaces:**
- Consumes: Task 8–14 endpoints via `apiFetch`.
- Produces: pages at the routes from Task 20; `ChangePasswordPage` at `/account/password`.

- [ ] **Step 1: Write failing tests** — sign-in shows "Invalid username / password combination" (plus the support email `engineering@to-cs.org`) on 401 and the lock message with the wait time on 429; the username input trims whitespace before submit; forgot-password and forgot-username always show the same neutral confirmation regardless of API result; reset and invitation pages show an "invalid or expired link" state when the token check returns 404; the password fields enforce ≥ 10 characters client-side and show server `PASSWORD_MISMATCH`/`PHONE_MISMATCH` errors on the right field; register shows "email already registered — use Forgot username" on 409.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** with Ant Design forms.
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(frontend): public auth and password pages`.

### Task 22: Home role panels and parent family/person pages

**Files:**
- Create: `frontend/src/pages/home/{HomePage.tsx, panels.ts}`, `frontend/src/pages/parent/{MyFamilyPage.tsx, EditAddressPage.tsx, AddParentPage.tsx, AddChildPage.tsx, EditPersonPage.tsx}`.
- Test: `frontend/src/pages/home/home.test.tsx`, `frontend/src/pages/parent/parent.test.tsx`.

**Interfaces:**
- Produces: `PANELS: { permission: string; title: string; links: {label: string; to: string}[] }[]` keyed by the `home.panel.*` codes; `HomePage` renders only the panels whose permission the user has (links for features from later phases are omitted until they exist); `MyFamilyPage` at `/parent/family` lists the family, parents and children and links to the edit pages; forms mirror Task 15 validation (child requires birth year/month; zipcode 5 digits; phone 10 digits displayed as `(805) 555-1234`).

- [ ] **Step 1: Write failing tests** — a Student Parent `/me` shows only the Student Parent panel; Super User shows every panel; Chinese names render unchanged; adding a child without birth month shows the field error and does not call the API; a 404 from the API on another family's id shows "Not found".
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(frontend): home panels and parent family pages`.

### Task 23: Registration-officer and admin pages

**Files:**
- Create: `frontend/src/pages/registration/{PeoplePage.tsx, PersonPage.tsx, NewFamilyPage.tsx, FamilyPage.tsx}`, `frontend/src/pages/admin/{SchoolYearsPage.tsx, SchoolYearFormPage.tsx, BookChargesPage.tsx, SchoolClassesPage.tsx, SchoolClassFormPage.tsx, RolesPage.tsx, RoleDetailPage.tsx, InvitePage.tsx}`, `frontend/src/lib/money.ts`.
- Test: `frontend/src/lib/money.test.ts`, `frontend/src/pages/admin/admin.test.tsx`, `frontend/src/pages/registration/registration.test.tsx`.

**Interfaces:**
- Produces: `parseDollarsToCents(input: string): number | null` and `formatCents(cents: number): string` in `money.ts` (no floats; same grammar as backend `dollarsToCents`); people search with debounce 300 ms and server pagination; school-year form disables date inputs whose stored value is in the past (mirrors `applyDateEdits`) and shows all money fields in dollars while sending integer cents; class list with per-year active toggles; roles pages for Super User; invite page (person id + email).

- [ ] **Step 1: Write failing tests** — `parseDollarsToCents('19.99') === 1999`, `'20' → 2000`, `'0.5' → 50`, `'19.999' → null`, `'abc' → null`; saving the school-year form with tuition `380.00` PUTs/PATCHes `38000`; past dates render disabled, future/empty dates editable; typing in people search issues a single request after 300 ms; the active toggle calls `PUT /school-classes/:id/active` with the clicked year id; menu entries for `/admin/*` hidden for a Registration Officer without `access.roles.read` but visible for school years.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** — PASS.
- [ ] **Step 5: Commit** — `feat(frontend): registration officer and admin pages`.

---

## Part E — Delivery

### Task 24: Container images, production Compose, Caddy

**Files:**
- Create: `deploy/Dockerfile.backend`, `deploy/Dockerfile.frontend`, `deploy/compose.prod.yml`, `deploy/Caddyfile`, `deploy/.env.prod.example`.
- Test: `deploy/test/stack.test.sh`.

**Interfaces:**
- Produces: images `ghcr.io/<owner>/tocs-api` and `ghcr.io/<owner>/tocs-web`; Compose services `caddy`, `api`, `postgres`, `migrate` (one-shot, uses `DATABASE_MIGRATOR_URL`); networks: `edge` (caddy, api) and `internal` (api, postgres, migrate; no host port for postgres). `api` runs as non-root, `read_only: true`, `cap_drop: [ALL]`, tmpfs `/tmp`. Caddy serves the static front end, proxies `/api/*` and `/healthz` to `api`, falls back to `index.html` for client routes, sets `Strict-Transport-Security`, `Content-Security-Policy` (default-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; the gateway script origin is added by the payments phase), `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`.

- [ ] **Step 1: Write failing test** — `stack.test.sh` brings up the prod Compose with a local-HTTPS Caddy config and a throwaway database, then asserts: `curl -k https://localhost/healthz` returns `{"status":"ok"}`; response headers include HSTS and CSP; `curl https://localhost/some/client/route` returns the SPA HTML; Postgres is not reachable on any host port; `docker compose exec api id -u` is not `0`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** multi-stage Dockerfiles (build with dev dependencies, run with production dependencies only; backend entrypoint does not run migrations).
- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit** — `feat(deploy): images, production compose and Caddy config`.

### Task 25: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`.

**Interfaces:**
- Produces jobs on every PR: `backend` (lint, typecheck, unit, integration against a `postgres:16` service with `init-roles.sql`), `frontend` (lint, typecheck, test, `npm run gen:api` + `git diff --exit-code`), `migrations` (`node scripts/check-migrations.mjs backend/prisma/migrations`), `secrets` (gitleaks), `vuln` (`npm audit --omit=dev --audit-level=high` in both apps and Trivy on the built images); on push to `master`: `images` builds and pushes the two images to GHCR tagged with the commit SHA.

- [ ] **Step 1: Write the workflow** with the jobs above; cache npm; required status checks are all PR jobs.
- [ ] **Step 2: Validate** — `npx @action-validator/cli .github/workflows/ci.yml` (or `actionlint`) passes; open a draft PR from the work branch and confirm every job runs green.
- [ ] **Step 3: Prove the gates bite** — on a scratch branch add `DROP TABLE users;` to a migration, an AWS-key-shaped string to a file, and delete one line of the generated API types; confirm `migrations`, `secrets` and `frontend` jobs fail; discard the branch.
- [ ] **Step 4: Commit** — `ci: build, test, scan and publish images`.

### Task 26: Deploy workflow, backup and restore, rollback

**Files:**
- Create: `.github/workflows/deploy.yml`, `deploy/deploy.sh`, `deploy/backup.sh`, `deploy/restore.sh`, `deploy/test/backup-roundtrip.sh`.

**Interfaces:**
- Produces: `deploy/backup.sh <dest-dir>` — `pg_dump -Fc` of the app database, encrypted with `age` to the recipient in `BACKUP_AGE_RECIPIENT`, optionally uploaded with `rclone copy` when `BACKUP_REMOTE` is set; prints the artifact path. `deploy/restore.sh <artifact> <database-url>` decrypts (key from `BACKUP_AGE_IDENTITY_FILE`) and restores. `deploy/deploy.sh <image-tag>` on the host: (1) run `backup.sh`, (2) record the currently running tag in `/opt/tocs/previous_tag`, (3) `docker compose pull`, (4) run the one-shot `migrate` service, (5) `docker compose up -d api caddy`, (6) poll `https://<host>/healthz` for up to 60 s, (7) on any failed step re-run `up -d` with the previous tag and exit non-zero. `deploy.yml` is `workflow_dispatch` on a GitHub Environment `production` with required reviewers, and runs `deploy.sh` over SSH.

- [ ] **Step 1: Write failing test** — `backup-roundtrip.sh` (CI-runnable with a Postgres container): create a table with sample rows including a Chinese string, run `backup.sh`, drop the table, run `restore.sh`, assert rows (including the Chinese string) are back; assert the artifact is not readable without the identity; assert `deploy.sh` with a deliberately failing health URL exits non-zero and restores the previous tag (tags observable via `docker compose ps`).
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the scripts (`set -euo pipefail`, no secrets echoed) and the workflow.
- [ ] **Step 4: Run test** — PASS.
- [ ] **Step 5: Commit** — `feat(deploy): backup, restore, deploy and rollback`.

### Task 27: Host hardening with Ansible

**Files:**
- Create: `deploy/ansible/{site.yml, inventory.example, roles/hardening/tasks/main.yml, roles/docker/tasks/main.yml, roles/app/tasks/main.yml}`.
- Test: `deploy/ansible/molecule` scenario or `deploy/test/ansible-check.sh`.

**Interfaces:**
- Produces: a playbook that on a fresh Ubuntu LTS host: installs Docker Engine and Compose plugin; configures UFW to allow only 22, 80, 443; sets `PermitRootLogin no`, `PasswordAuthentication no`, `AllowUsers deploy`; installs and enables Fail2ban (sshd jail) and `unattended-upgrades` (security origin); creates user `deploy` and `/opt/tocs` (mode 750) with `.env` (mode 600, root-owned) rendered from variables; installs a systemd timer running `backup.sh` daily at 02:30 Pacific.

- [ ] **Step 1: Write failing test** — `ansible-check.sh` runs `ansible-lint` and `ansible-playbook --syntax-check`, then applies the playbook inside a privileged Ubuntu container (systemd image) and asserts `sshd -T | grep -E 'permitrootlogin no|passwordauthentication no'`, `ufw status` lists only 22/80/443, `/opt/tocs/.env` is `600`, and the backup timer is enabled.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the roles (idempotent: a second run reports zero changes).
- [ ] **Step 4: Run test** — PASS, second apply `changed=0`.
- [ ] **Step 5: Commit** — `feat(deploy): ansible host hardening and backup timer`.

---

## Self-Review Notes

- **Spec coverage:** spec §3 phase 1 → Tasks 1–27 (skeleton: 1, 24–27; login/reset: 8, 11–14, 21; users/roles/permissions: 9, 10; audit: 7; people/families: 15–17, 22–23; school year: 6, 18; grades/classes: 19). Spec §5 (sessions, tokens hashed, permission codes, default deny, object-level checks, audit) → 7–9, 11, 16. §6 (baseline, two accounts, additive migrations, Cents/PacificDate/Clock) → 3–5. §7 (error format, CSRF, DTO whitelist) → 2, 8. §8 (role-organized front end, error handling) → 20–23. §9 (Compose, Caddy, hardening, CI/CD, backups, rollback) → 24–27. **Deliberately not in this phase:** staff assignments, instructor assignments, class assignment, fees, payments, idempotency-key table (phases 2–3); reports/forms/final marks (phase 4).
- **Open items carried from the spec §11 (not blocking this plan):** production schema dump for `check-schema-drift.mjs` (Task 4 note), Postmark/SES choice and DNS (mail transport stays SMTP-URL configurable), merchant credentials (phase 2), off-host backup account (`BACKUP_REMOTE`), error-reporting service.
- **Type consistency:** `Cents`, `PacificDate`, `Clock`, `AppError`, `AuditService.record`, `SchoolYearLookup`, `AuthTokenService`, `PasswordService`, `PermissionCode` are defined once (Tasks 2–3, 6–9, 11) and only consumed afterwards.
