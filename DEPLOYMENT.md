# Deployment Guide

## Pre-Deployment Checklist

- [ ] Update `.env` with production values
- [ ] Change default admin password
- [ ] Set strong JWT_SECRET
- [ ] Configure production database
- [ ] Set up backup strategy
- [ ] Configure reverse proxy (nginx/caddy)
- [ ] Set up SSL/TLS certificates

## Production Environment Variables

Create a production `.env` file:

```bash
# Database
DATABASE_URL=postgresql://user:password@db-host:5432/northstar

# Server
PORT=3000
NODE_ENV=production

# Paths (absolute paths)
BOOKS_PATH=/var/lib/northstar/books
COVERS_PATH=/var/lib/northstar/covers
THUMBNAILS_PATH=/var/lib/northstar/thumbnails
CONFIG_PATH=/var/lib/northstar/config

# Security
JWT_SECRET=<generate-a-strong-random-secret>

# Optional
GOOGLE_BOOKS_API_KEY=your-api-key-here
```

## Docker Deployment (Recommended)

### 1. Build and Start Services

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# Run database migrations
docker-compose exec api npm run migrate

# Check logs
docker-compose logs -f
```

### 2. Access the Application

- Web UI: http://your-server:5173
- API: http://your-server:3000
- Default login: admin/admin (CHANGE THIS!)

### 3. Add Books

```bash
# Copy books to the mounted volume
cp /path/to/books/*.epub /path/to/northstar/books/

# Trigger scan from web UI Admin panel
# Or via API:
curl -X POST http://your-server:3000/api/admin/scan \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Manual Deployment

### 1. Set Up Database

```bash
# Install PostgreSQL 16
# Create database and user
createdb northstar
createuser -P northstar

# Run migrations
cd server
npm run migrate
```

### 2. Build Frontend

```bash
cd web
npm install
npm run build

# Serve build directory with nginx or similar
# Build output is in: web/dist/
```

### 3. Start Backend Services

```bash
cd server
npm install

# Start API server (use pm2 or systemd)
pm2 start npm --name northstar-api -- run start

# Start worker service
pm2 start npm --name northstar-worker -- run worker

# Save pm2 process list
pm2 save
pm2 startup
```

## Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        root /path/to/northstar/web/dist;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:3000;
    }
}
```

## SSL/TLS with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured by default
```

## Backup Strategy

### Database Backups

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump northstar | gzip > /backups/northstar_$DATE.sql.gz

# Keep last 30 days
find /backups -name "northstar_*.sql.gz" -mtime +30 -delete
```

### Book Files & Covers

```bash
# Rsync to backup location
rsync -av /var/lib/northstar/ /backups/northstar-data/
```

## Monitoring

### Health Check Endpoint

```bash
curl http://localhost:3000/health
```

### Log Locations (Docker)

```bash
# API logs
docker-compose logs -f api

# Worker logs
docker-compose logs -f worker

# Database logs
docker-compose logs -f postgres
```

## Security Hardening

1. **Change Default Password**
   - Login and change admin password immediately
   - Or update via database directly

2. **Firewall Rules**
   ```bash
   # Allow only necessary ports
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw enable
   ```

3. **Database Security**
   - Use strong passwords
   - Restrict PostgreSQL to localhost or internal network
   - Enable SSL connections

4. **JWT Secret**
   - Generate strong random secret: `openssl rand -base64 64`
   - Never commit to git

## Troubleshooting

### Database Connection Issues

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT 1"

# Check PostgreSQL is running
docker-compose ps postgres
# or
systemctl status postgresql
```

### API Not Responding

```bash
# Check logs
docker-compose logs api

# Verify port is listening
netstat -tlnp | grep 3000
```

### Books Not Appearing

```bash
# Check scan status
curl http://localhost:3000/api/admin/scans \
  -H "Authorization: Bearer TOKEN"

# Check worker logs
docker-compose logs worker

# Verify file permissions
ls -la /var/lib/northstar/books/
```

## Scaling

### Read Replicas

- Set up PostgreSQL read replicas for read-heavy workloads
- Configure pgpool-II for connection pooling

### Load Balancing

- Use nginx/haproxy to load balance multiple API instances
- Ensure shared storage for book files and covers

### Caching

- Add Redis for session storage and API caching
- Enable nginx caching for static assets

## Updates

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose build
docker-compose up -d

# Run migrations if needed
docker-compose exec api npm run migrate
```

## Support

For issues and questions:
- Check logs first
- Review this deployment guide
- Check the main README.md

---

Built by Raina Corporation Limited ©
