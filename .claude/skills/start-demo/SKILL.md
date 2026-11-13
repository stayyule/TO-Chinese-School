---
name: start-demo
description: Use when asked to start, run, launch, or demo the new TOCS Chinese School app (NestJS backend + Vite frontend on branch feat/subproject-1-foundation), or when localhost:5173 / localhost:3000 is not responding.
---

# Start Demo (new TOCS stack)

Runs the NEW code (not the legacy Rails app) from the worktree `C:\Users\leyu0002\Documents\GitHub\TO-Chinese-School-sp1` (branch `feat/subproject-1-foundation`). Never start `chineseschool/` (Rails) for demos.

Ports: frontend http://localhost:5173 (proxies `/api` to backend), backend :3000, Postgres :5433, Mailpit UI http://localhost:8025 (all registration/reset mail lands here).

## Steps (PowerShell; Docker lives in WSL `Ubuntu-22.04`)

1. **DB + mail containers** (idempotent):
   `wsl -d Ubuntu-22.04 -- bash -lc 'cd /mnt/c/Users/leyu0002/Documents/GitHub/TO-Chinese-School-sp1/deploy && docker compose -f compose.dev.yml -p tocs-dev up -d'`
2. **First run only** (check `docker exec tocs-dev-postgres-1 psql -U postgres -d tocs_dev -Atc "select count(*) from roles"` → 0 or error means not initialised). Follow `backend/prisma/migrations/README.md` "Dev": load `backend/db/baseline.sql` as postgres, re-run `deploy/db/init-roles.sql` (with `PGOPTIONS='-c tocs.allow_dev_passwords=on'`), run `deploy/db/prisma-migrations-table.sql` and `deploy/db/grants.sql` as `tocs_migrator` (password `tocs_migrator_dev`), then in `backend/`: `npx prisma migrate deploy`, and `npm run seed` with `$env:DATABASE_URL='postgresql://tocs_app:tocs_app_dev@localhost:5433/tocs_dev'` (seed does not read `.env`).
   `backend/.env` is git-ignored: copy from `.env.example` and set a long `SESSION_SECRET`.
3. **Backend** (background): `cd backend; npm run start:dev` → wait for "Nest application successfully started".
4. **Frontend** (background): `cd frontend; npm run dev` → Vite on 5173.
5. **Verify**: `curl.exe -s -o NUL -w "%{http_code}" http://localhost:5173/` is 200; open it in the browser pane.

6. **Demo data** (once, after the demo-admin user exists): `node .claude/skills/start-demo/seed-demo-data.mjs` — seeds grades, 2 school years, 15 classes, 6 families and users `registrar` / `principal` / `parent-chen` (same password). Run the backend without surprises: watch mode restarts on file changes and can reset a seeding run mid-way; if it fails midway, delete rows from `school_class_active_flags`, `school_classes`, `book_charges`, `school_years` and rerun.
7. Demo script for presenting: `docs/demo/DEMO_FLOW.zh-CN.md`.

## Notes

- Windows PostgreSQL 17 on :5432 is unrelated and needs a password; don't use it.
- Demo login (local dev only): username `demo-admin`, password `Demo-Passw0rd-2026`, role Super User. A fresh/wiped DB has no users: insert a `people` row, a `users` row (`password_hash_v2` = argon2id hash made with backend's `argon2`, options in `src/auth/password.service.ts`) and a `roles_users` row for role `Super User` (as postgres via `docker exec ... psql`).
- Stop: TaskStop the two background tasks; `docker compose -p tocs-dev down` (add `-v` to wipe data and force step 2 again).

## Common mistakes

| Mistake | Fix |
|---|---|
| Running seed without `DATABASE_URL` | Set it in the shell first |
| Backend refuses to boot | `.env` missing or `SMTP_URL` unset with `MAIL_TRANSPORT=smtp` |
| Git Bash mangles `/mnt/c/...` paths | Use PowerShell for `wsl ...` commands |
