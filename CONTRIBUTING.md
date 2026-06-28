# Contributing to North Star

Thanks for your interest in improving North Star! This guide covers how to get
set up and what we expect in a pull request.

## Project layout

- `server/` — Express + TypeScript API and background worker; PostgreSQL via
  `pg-promise`. Tests run with Vitest.
- `web/` — React + Vite + TypeScript single-page app (the reader and library UI).

## Getting started

```bash
# Database, server, and web all run via docker-compose for a quick start:
docker compose up --build

# Or run the pieces directly for development:
cd server && npm install && npm run migrate:dev && npm run dev   # API on :3000
cd server && npm run worker:dev                                  # background worker
cd web    && npm install && npm run dev                          # web on :5173
```

The first account you register becomes the admin (registration then closes).

## Before you open a PR

Run these locally — CI runs the same checks and will block on failures:

```bash
# Server
cd server
npm run lint        # ESLint (no new `any`; warnings are tolerated, errors are not)
npm test            # Vitest
npm run build       # tsc typecheck + asset copy

# Web
cd web
npm run build       # tsc typecheck + Vite build
```

## Guidelines

- **Match the surrounding style.** No new ESLint errors; prefer real types over
  `any`.
- **Add tests for non-trivial logic.** The scanner, metadata enricher, dedupe,
  auth, and migrations all have unit tests — follow those patterns
  (`server/src/tests/`).
- **Database changes go through migrations.** Add a numbered file under
  `server/src/db/migrations/` (see the README there). Never edit a released
  migration.
- **Keep changes focused.** One logical change per PR; describe what and why.
- **Security-sensitive areas** (auth, file serving, path handling) deserve extra
  care and tests.

## Reporting bugs / requesting features

Open an issue using the provided templates. Include reproduction steps,
expected vs actual behavior, and your deployment method (docker-compose vs.
manual) plus versions.
