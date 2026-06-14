# Deployment Guide

## Pre-Deployment Checklist

- [ ] Generate a strong `JWT_SECRET` (`openssl rand -base64 64`)
- [ ] Set a strong `POSTGRES_PASSWORD` in `.env`
- [ ] Set `CORS_ORIGIN` to your public frontend URL
- [ ] Place all values in a `.env` file (never commit it)
- [ ] Put a TLS-terminating reverse proxy in front of port 8080
- [ ] Run database migrations and create the initial admin via `/register`
- [ ] Set up a database backup strategy
- [ ] (Optional) Obtain a Google Books API key for richer metadata

## Required Environment Variables

Copy `.env.example` to `.env` and fill in every value before starting:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | **Yes** | Strong password for the Postgres user |
| `JWT_SECRET` | **Yes** | Random 64-byte secret — `openssl rand -base64 64` |
| `CORS_ORIGIN` | Recommended | Public URL of the web UI, e.g. `https://books.example.com` |
| `BOOKS_LIBRARY_PATH` | Yes | Absolute path to your EPUB/PDF files on the host |
| `GOOGLE_BOOKS_API_KEY` | No | Improves metadata quality |

## TLS / HTTPS (Required for Production)

**The included nginx container listens on HTTP only (port 80 inside the container,
mapped to `WEB_PORT` on the host).  You MUST terminate TLS outside this stack.**

Put a TLS-aware reverse proxy in front before exposing to the internet:

### Option A — Caddy (simplest, auto-HTTPS)

```caddyfile
books.example.com {
    reverse_proxy localhost:8080
}
```

### Option B — nginx + Let's Encrypt (certbot)

```nginx
server {
    listen 443 ssl;
    server_name books.example.com;

    ssl_certificate     /etc/letsencrypt/live/books.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/books.example.com/privkey.pem;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name books.example.com;
    return 301 https://$host$request_uri;
}
```

Obtain a certificate with certbot:
```bash
sudo certbot --nginx -d books.example.com
```

### Firewall

Only expose ports needed by your reverse proxy (80, 443).  The Postgres port
is intentionally not published by docker-compose — never expose it to the host
or internet.

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## Docker Deployment

### 1. Prepare the environment file

```bash
cp .env.example .env
# Fill in POSTGRES_PASSWORD, JWT_SECRET, CORS_ORIGIN, BOOKS_LIBRARY_PATH
```

### 2. Build and start services

```bash
docker-compose build
docker-compose up -d
```

### 3. Run database migrations

```bash
docker-compose exec api npm run migrate
```

### 4. Create the initial admin account

On a fresh database **no admin account exists**.  Open the web UI (or use curl)
and call `/register` once to create your admin:

```bash
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"you@example.com","password":"<strong-password>","display_name":"Admin"}'
```

`/register` accepts requests only when zero users exist — it closes itself
automatically after the first account is created.

### 5. Add books and trigger a scan

```bash
# Copy books to the mounted volume
cp /path/to/books/*.epub "${BOOKS_LIBRARY_PATH}/"

# Trigger scan (replace TOKEN with the token from the register response)
curl -X POST http://localhost:8080/api/admin/scan \
  -H "Authorization: Bearer $TOKEN"
```

### 6. Check logs

```bash
docker-compose logs -f api
docker-compose logs -f worker
docker-compose logs -f postgres
```

## Manual Deployment

### 1. Set up the database

```bash
createdb northstar
createuser -P northstar
psql northstar -c "GRANT ALL PRIVILEGES ON DATABASE northstar TO northstar;"
psql northstar -c "GRANT ALL ON SCHEMA public TO northstar;"
```

### 2. Build the frontend

```bash
cd web
npm install
npm run build
# Serve web/dist/ with nginx or caddy (with TLS)
```

### 3. Build and start backend services

```bash
cd server
npm install
npm run build

# Copy .env.example → .env and fill in values
cp .env.example .env

# Run migrations
npm run migrate

# Start API server (use pm2 or systemd)
pm2 start npm --name northstar-api -- run start

# Start worker service
pm2 start npm --name northstar-worker -- run worker

pm2 save && pm2 startup
```

### 4. Create the initial admin account

Visit the `/register` endpoint once to create your admin (same curl command as
in the Docker section above, pointing at your server's host/port).

## nginx Configuration (for manual deploys)

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # Frontend
    location / {
        root /path/to/northstar/web/dist;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Uploads & the books volume

The web UI's **Upload a Book** feature (Admin panel) writes new EPUB/PDF files
into the library. For this to work the `api` service mounts the books volume
**read-write** (`docker-compose.yml`):

```yaml
api:
  volumes:
    - ${BOOKS_LIBRARY_PATH:-./books}:/books   # read-write (was :ro)
```

**Security implication:** the API process can now create/overwrite files under
`BOOKS_LIBRARY_PATH`. To contain the risk:

- Uploads are **admin-only** (`POST /api/books/upload`, `requireAdmin`).
- Only `.epub`/`.pdf` extensions are accepted, with a size cap
  (`UPLOAD_MAX_MB`, default 200 MB).
- Filenames are sanitized and resolved with the existing `resolveWithin`
  traversal guard, then written under a dedicated `uploads/` subfolder — a
  malicious name cannot escape the books directory.
- The **worker** keeps its books mount **read-only**; only the API writes.

If you do not want uploads enabled, revert the `api` mount to `:ro`; the rest of
the app is unaffected (the endpoint will simply fail to write).

After a successful upload the API creates a scan record and returns immediately;
the worker imports the file and extracts metadata/cover asynchronously (the
request never blocks on a full library scan).

## OPDS catalog (external readers)

An OPDS 1.x (Atom) catalog is served at **`/api/opds`** so external readers
(KOReader, Marvin, Moon+ Reader, Thorium, etc.) can browse and download books.

- Root catalog: `https://books.example.com/api/opds`
- Navigation: Recently Added, All Books, By Author, By Series, By Tag
- Acquisition links point at an authenticated download route with HTTP Range
  support, so resumable downloads work.

**Authentication bridge:** OPDS clients send HTTP **Basic** credentials. The
server verifies `username:password` against the existing user table with bcrypt
(the same check as `/api/auth/login`) and maps the request to that user — no
separate OPDS account is needed. A Bearer token is also accepted so the catalog
can be opened in a browser. Always serve OPDS over TLS (see above), since Basic
auth sends credentials with every request.

Point your reader at the root URL and enter your North Star username/password:

```
Catalog URL: https://books.example.com/api/opds
Username:    <your North Star username>
Password:    <your North Star password>
```

## Backup Strategy

### Database

```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump northstar | gzip > /backups/northstar_$DATE.sql.gz
find /backups -name "northstar_*.sql.gz" -mtime +30 -delete
```

### Book files and covers

```bash
rsync -av /var/lib/northstar/ /backups/northstar-data/
```

## Monitoring

```bash
# Health check
curl http://localhost:3000/health

# API logs (Docker)
docker-compose logs -f api

# Worker logs (Docker)
docker-compose logs -f worker
```

## Troubleshooting

### Server refuses to start with JWT_SECRET error

The API will exit immediately if `JWT_SECRET` is unset or set to the default
value in `NODE_ENV=production`.  Generate a secret and add it to your `.env`:

```bash
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env
```

### Database connection issues

```bash
# Test from the host (Postgres is NOT port-forwarded to the host in production)
docker-compose exec postgres psql -U northstar -c "SELECT 1"
```

### Books not appearing

```bash
# Check scan status
curl http://localhost:3000/api/admin/scans \
  -H "Authorization: Bearer $TOKEN"

docker-compose logs worker
```

## Scaling

- Use PostgreSQL read replicas for read-heavy workloads
- Load-balance multiple `api` replicas behind nginx/haproxy
- Multiple `worker` replicas are safe — the worker uses a Postgres advisory
  lock to prevent two replicas from processing the same scan simultaneously

## Updates

```bash
git pull origin main
docker-compose build
docker-compose up -d
docker-compose exec api npm run migrate
```

---

Built by Raina Corporation Limited ©
