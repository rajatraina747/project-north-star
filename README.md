# North Star - Self-Hosted Book Server

A self-hosted book library server similar to Plex, for managing and reading EPUB and PDF books across your network.

## Current Status

✅ **Production Ready - Fully Functional Book Server**

**Backend (100% Complete)**
- PostgreSQL database with full schema
- REST API server with JWT authentication
- Worker service for scanning and metadata extraction
- Automatic metadata enrichment from file contents
- Reading progress tracking (EPUB & PDF)

**Frontend (100% Complete)**
- Login and authentication flow
- Home page with Continue Reading & Recently Added
- Library view with search, filters, and sorting
- Book details pages
- EPUB reader with progress tracking
- PDF reader with progress tracking
- Admin panel for scans and system management

**Features**
- Book scanning and import (EPUB + PDF)
- Automatic metadata extraction (title, author, publisher, ISBN, description, page count)
- Author and series management
- Search and filtering
- Reading progress sync across devices
- Cover image extraction and thumbnails
- Mobile-responsive design

## Quick Start (Local Development)

### Prerequisites
- Node.js 20+
- PostgreSQL 16+

### 1. Setup Database
```bash
# Install PostgreSQL (macOS)
brew install postgresql@16
brew services start postgresql@16

# Create database
createdb northstar
psql postgres -c "CREATE USER northstar WITH PASSWORD 'northstar';"
psql postgres -c "GRANT ALL PRIVILEGES ON DATABASE northstar TO northstar;"
psql northstar -c "ALTER DATABASE northstar OWNER TO northstar;"
psql northstar -c "GRANT ALL ON SCHEMA public TO northstar;"
```

### 2. Configure Environment

Copy the example environment file and update paths:

```bash
cp .env.example .env
# Edit .env with your absolute paths
```

### 3. Start Backend

```bash
cd server

# Install dependencies
npm install

# Run database migrations
npm run migrate:dev

# Start API server (in one terminal)
npm run dev

# Start worker service (in another terminal)
npm run worker:dev
```

API will be available at `http://localhost:3000`

### 4. Start Frontend

```bash
cd web

# Install dependencies
npm install

# Start development server
npm run dev
```

Web UI will be available at `http://localhost:5173`

Default login: **admin** / **admin**

### 5. Add Books

```bash
# Copy your EPUB/PDF files to the books folder
cp /path/to/your/books/*.{epub,pdf} books/

# Login and trigger scan
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin"}' | jq -r '.token')

curl -X POST http://localhost:3000/api/admin/scan \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### 6. Test the API (Optional)

```bash
# Health check
curl http://localhost:3000/health

# List books
curl http://localhost:3000/api/books \
  -H "Authorization: Bearer $TOKEN" | jq

# Library stats
curl http://localhost:3000/api/library/stats \
  -H "Authorization: Bearer $TOKEN" | jq
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login (default: admin/admin)
- `POST /api/auth/register` - Register new user
- `GET /api/auth/me` - Get current user

### Books
- `GET /api/books` - List books (with search, filter, pagination)
- `GET /api/books/:id` - Get book details
- `PUT /api/books/:id` - Update book metadata
- `DELETE /api/books/:id` - Delete book
- `GET /api/books/:id/download` - Download book file
- `GET /api/books/:id/cover` - Get book cover image

### Library
- `GET /api/library/stats` - Library statistics
- `GET /api/authors` - List authors
- `GET /api/series` - List series
- `GET /api/recent` - Recently added books

### Admin
- `POST /api/admin/scan` - Trigger library scan
- `GET /api/admin/scans` - View scan history
- `GET /api/admin/users` - Manage users

### Reading Progress
- `GET /api/progress/:bookId` - Get reading progress
- `PUT /api/progress/:bookId` - Update reading progress

## Project Structure

```
.
├── server/              # Backend API + Worker
│   ├── src/
│   │   ├── db/         # Database migrations and queries
│   │   ├── routes/     # API endpoints
│   │   ├── services/   # Business logic (scanner, metadata)
│   │   ├── middleware/ # Auth, error handling
│   │   ├── utils/      # Config, logger
│   │   ├── index.ts    # API server entry
│   │   └── worker.ts   # Worker service entry
│   └── .env            # Backend configuration
├── web/                 # Frontend (React + Vite)
│   └── src/
│       ├── components/ # React components
│       ├── pages/      # Page components
│       └── lib/        # API client, utilities
├── books/              # Your book files (EPUB, PDF)
├── data/               # Generated data
│   ├── covers/        # Book cover images
│   ├── thumbnails/    # Cover thumbnails
│   └── config/        # Runtime config
└── docker-compose.yml  # Docker deployment (optional)
```

## Environment Variables

Backend configuration is in `server/.env`:

```bash
DATABASE_URL=postgresql://northstar:northstar@localhost:5432/northstar
PORT=3000
BOOKS_PATH=/absolute/path/to/books
COVERS_PATH=/absolute/path/to/data/covers
THUMBNAILS_PATH=/absolute/path/to/data/thumbnails
CONFIG_PATH=/absolute/path/to/data/config
JWT_SECRET=change-me-in-production
GOOGLE_BOOKS_API_KEY=optional-for-enhanced-metadata
```

## Screenshots

*Coming soon - add screenshots of your deployed instance*

## Features in Detail

### EPUB Reader
- Interactive reading experience with epubjs
- Progress tracking and resume reading
- Font size adjustment (80%-150%)
- Multiple navigation methods: keyboard arrows, mouse wheel, click zones
- Chapter titles displayed
- Progress bar with seek functionality

### PDF Reader
- Full PDF rendering with pdf.js
- Page navigation and zoom controls
- Progress tracking by page number
- Thumbnail navigation
- Full-screen support

### Library Management
- Automatic metadata extraction from EPUB/PDF files
- Cover image extraction and thumbnail generation
- Search across titles, authors, and descriptions
- Filter by format, author, and series
- Sort by title, author, or date added

### Docker Deployment

When ready to deploy:

```bash
docker-compose up -d
docker-compose exec api npm run migrate
```

## Technology Stack

**Backend:**
- Node.js 20 + TypeScript
- Express.js (API server)
- PostgreSQL (database)
- JWT authentication
- epub2 (EPUB parsing)
- pdf-parse (PDF parsing)
- Sharp (image processing)

**Frontend:**
- React 18
- Vite (build tool)
- TypeScript
- TailwindCSS
- React Router

## License

MIT

## Credits

Built by Raina Corporation Limited ©
