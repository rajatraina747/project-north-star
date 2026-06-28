# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Versioned database migrations: numbered SQL files under
  `server/src/db/migrations/` tracked in a `schema_migrations` table, replacing
  the single idempotent `schema.sql`.
- Prometheus metrics endpoint at `GET /metrics` (process/Node metrics, HTTP
  request count + latency histograms, library-size gauges).
- Backup/restore scripts (`server/scripts/backup.sh`, `restore.sh`) for the
  database and generated data directory.
- Server-side PDF cover extraction: rasterizes page 1 when no embedded/external
  cover is available.
- True streaming for PDFs: reader fetches byte ranges via short-lived signed
  file tickets instead of buffering the whole file in memory.
- Account lockout after repeated failed logins (configurable threshold/window).
- Reading insights: longest streak and reading pace (pages/hour) on the Stats
  page.
- ESLint configuration for the server; CI lint step is now meaningful.
- Test suites for the scanner, metadata enricher, dedupe report, migrations,
  file tickets, streaks, metrics, and account lockout.

### Changed
- Series cache freshness (`isSeriesFresh`) now guards provider refreshes, with a
  `force` flag so user-triggered refreshes still bypass the cache.
- `bcrypt` cost factor unified behind a single configurable constant.
- `Cache-Control` (with ETag revalidation) added to cover and file routes.

### Fixed
- Removed all `any` usages in server source in favor of real types, surfacing and
  fixing a few latent shape mismatches.
