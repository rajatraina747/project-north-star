# ✦ North Star

> **Your personal book server. No subscriptions. No cloud. No nonsense.**

North Star is a self-hosted library for EPUB and PDF books — think Plex, but for your reading list. Drop in your files, let it scan and enrich metadata automatically, then read from any device on your network with your progress synced everywhere.

[![CI](https://github.com/rajatraina747/north-star/actions/workflows/ci.yml/badge.svg)](https://github.com/rajatraina747/north-star/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/Node.js-20%2B-brightgreen)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%2B-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## What it does

| | |
|---|---|
| 📚 **Scans your library** | Point it at a folder. It finds every EPUB and PDF, pulls metadata (title, author, ISBN, description, cover art) from the files themselves and from Google Books / Open Library, and keeps everything tidy. |
| 📖 **Read in the browser** | Full EPUB reader (epubjs) and PDF reader (pdf.js) — no app to install, works on phones and tablets too. |
| 🔖 **Remembers where you left off** | Reading progress is stored server-side and synced across every device. Pick up your book on your laptop where you stopped on your phone. |
| 🔒 **Yours alone** | JWT authentication, no telemetry, no external accounts. Everything stays on hardware you control. |

---

## Screenshots

*Coming soon — add screenshots of your deployed instance here.*

---

## Tech Stack

**Backend** — Node.js 20 · TypeScript · Express · PostgreSQL 16 · JWT auth · Sharp · epub2 · pdf-parse

**Frontend** — React 18 · Vite · TypeScript · TailwindCSS · React Router · epubjs · pdf.js

**Infra** — Docker Compose · nginx · GitHub Actions CI

---

## Quick Start (Local Development)

### Prerequisites

- Node.js 20+
- PostgreSQL 16+

### 1. Set up the database

```bash
# macOS
brew install postgresql@16 && brew services start postgresql@16

createdb northstar
psql postgres -c "CREATE USER northstar WITH PASSWORD 'northstar';"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE northstar TO northstar;"
psql northstar -c "ALTER DATABASE northstar OWNER TO northstar;"
psql northstar -c "GRANT ALL ON SCHEMA public TO northstar;"
```

### 2. Configure the environment

```bash
cp .env.example .env
# Fill in BOOKS_LIBRARY_PATH and any other paths for your machine
```

### 3. Start the backend

Open two terminals:

```bash
# Terminal 1 — API server
cd server
npm install
npm run migrate:dev
npm run dev
# → http://localhost:3000
```

```bash
# Terminal 2 — background worker (scans + metadata)
cd server
npm run worker:dev
```

### 4. Start the frontend

```bash
cd web
npm install
npm run dev
# → http://localhost:5173
```

### 5. Create your admin account

On a fresh database there are no users. Open `http://localhost:5173` — you'll be
taken straight to a registration screen. Create your account and you're in.
`/register` closes itself permanently once the first user exists.

### 6. Add books and scan

Drop EPUB and PDF files into your `books/` folder (or wherever `BOOKS_LIBRARY_PATH` points), then hit the **Scan** button in the Admin panel. The worker will pick them up, enrich metadata, grab cover art, and have them ready in your library within seconds.

---

## Docker Deployment

The fastest way to a production-ready instance:

```bash
# 1. Copy and fill in your secrets
cp .env.example .env
#    Set POSTGRES_PASSWORD, JWT_SECRET (openssl rand -base64 64), CORS_ORIGIN

# 2. Build and start everything
docker-compose build
docker-compose up -d

# 3. Run migrations
docker-compose exec api npm run migrate

# 4. Create your admin account via /register (same as local setup)
```

The web UI is on port `8080` by default. **Put a TLS-terminating reverse proxy (Caddy, nginx + certbot) in front before exposing to the internet** — see [DEPLOYMENT.md](DEPLOYMENT.md) for full instructions including Caddy/nginx config examples.

---

## Project Structure

```
.
├── server/                 # Backend — API server + background worker
│   └── src/
│       ├── db/             # Schema + migrations
│       ├── routes/         # REST endpoints
│       ├── services/       # Scanner, metadata enricher, cover generator
│       ├── middleware/     # Auth
│       └── utils/          # Config, logger
├── web/                    # Frontend — React + Vite SPA
│   └── src/
│       ├── components/     # UI components
│       ├── pages/          # Route-level pages
│       └── lib/            # API client, auth store
├── books/                  # Your EPUB/PDF files (mount this volume)
├── data/                   # Generated: covers, thumbnails, config
├── .github/workflows/      # CI — lint + test + build on every push
└── docker-compose.yml
```

---

## API Reference

<details>
<summary><strong>Authentication</strong></summary>

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create first admin (open only when zero users exist) |
| `POST` | `/api/auth/login` | Login, returns JWT |
| `GET` | `/api/auth/me` | Current user info |

</details>

<details>
<summary><strong>Books</strong></summary>

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/books` | List all books (pagination + sort) |
| `GET` | `/api/books/recent` | Recently added |
| `GET` | `/api/books/continue` | In-progress books for the current user |
| `GET` | `/api/books/:id` | Full book details |
| `PATCH` | `/api/books/:id` | Update metadata *(admin)* |
| `DELETE` | `/api/books/:id` | Delete book *(admin)* |
| `GET` | `/api/books/:id/cover` | Cover image (`?thumbnail=true` for thumb) |
| `GET` | `/api/books/:id/file/:fileId` | Stream the book file |

</details>

<details>
<summary><strong>Search, Library, Admin, Progress</strong></summary>

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/search` | Full-text search with filters |
| `GET` | `/api/search/quick` | Title autocomplete |
| `GET` | `/api/library/stats` | Library statistics |
| `GET` | `/api/library/authors` | All authors |
| `GET` | `/api/library/authors/:id` | Author + their books |
| `GET` | `/api/library/series` | All series |
| `GET` | `/api/library/series/:id` | Series + books |
| `GET` | `/api/library/tags` | All tags |
| `POST` | `/api/admin/scan` | Trigger library scan *(admin)* |
| `GET` | `/api/admin/scans` | Scan history *(admin)* |
| `GET` | `/api/admin/settings` | App settings *(admin)* |
| `PUT` | `/api/admin/settings/:key` | Update a setting *(admin)* |
| `GET` | `/api/admin/health` | System health *(admin)* |
| `GET` | `/api/progress` | All reading progress for current user |
| `GET` | `/api/progress/:bookId/:fileId` | Progress for a specific file |
| `PUT` | `/api/progress/:bookId/:fileId` | Update reading progress |

</details>

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JWT_SECRET` | **Yes (prod)** | — | Random 64-byte secret. `openssl rand -base64 64` |
| `POSTGRES_PASSWORD` | **Yes** | — | Postgres password — no default in docker-compose |
| `CORS_ORIGIN` | Recommended | *(reflect origin)* | Public URL of the web UI |
| `BOOKS_LIBRARY_PATH` | Yes | `./books` | Host path to your EPUB/PDF files |
| `DATABASE_URL` | Dev only | `postgresql://northstar:…` | Full connection string |
| `GOOGLE_BOOKS_API_KEY` | No | — | Improves metadata & cover art quality |
| `JWT_EXPIRES_IN` | No | `24h` | Token lifetime |
| `PORT` | No | `3000` | API server port |

See [`.env.example`](.env.example) for the full list.

---

## Known Limitations

- **No PDF cover extraction.** PDFs only get a cover when one comes back from Google Books or Open Library. Rendering the first page to an image requires a native renderer that isn't bundled yet; EPUB covers (embedded) work fine.
- **EPUB/CBZ readers buffer the whole file (client-side).** PDFs now stream — pdf.js fetches byte ranges over a short-lived signed URL, so large scanned PDFs no longer load fully into memory. EPUB and CBZ are ZIP containers that epub.js/the comic reader still load wholesale; range streaming doesn't help them without a server-side zip-entry API.

---

## Contributing

PRs welcome. The project is actively developed — check open issues before starting something large.

Run the test suite before submitting:

```bash
cd server && npm test
```

---

## License

MIT © Raina Corporation Limited
