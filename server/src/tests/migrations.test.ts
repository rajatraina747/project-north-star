import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// runMigrations() reads numbered .sql files and applies only those not already
// recorded in schema_migrations, each in its own transaction. We mock fs and
// the db so the version-tracking logic is exercised without a real database.
// ---------------------------------------------------------------------------

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('fs', () => {
  // index.ts uses `await import('fs')` then named-style access, so default and
  // named exports must be the *same* spy instances.
  const fns = { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn() };
  return { default: fns, ...fns };
});

vi.mock('pg-promise', () => {
  const txInner = { none: vi.fn() };
  const db = {
    none: vi.fn().mockResolvedValue(undefined),
    manyOrNone: vi.fn().mockResolvedValue([]),
    one: vi.fn(),
    tx: vi.fn(async (cb: (t: typeof txInner) => unknown) => cb(txInner)),
    _tx: txInner,
  };
  const pgp = () => db;
  return { default: () => pgp };
});

import fs from 'fs';
import { db, runMigrations } from '../db';

const fsMock = fs as unknown as {
  existsSync: ReturnType<typeof vi.fn>;
  readdirSync: ReturnType<typeof vi.fn>;
  readFileSync: ReturnType<typeof vi.fn>;
};
const dbMock = db as unknown as {
  none: ReturnType<typeof vi.fn>;
  manyOrNone: ReturnType<typeof vi.fn>;
  tx: ReturnType<typeof vi.fn>;
  _tx: { none: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReturnValue(true);
  fsMock.readFileSync.mockReturnValue('-- sql');
  dbMock.none.mockResolvedValue(undefined);
  dbMock.tx.mockImplementation(async (cb: (t: typeof dbMock._tx) => unknown) => cb(dbMock._tx));
});

function txVersions() {
  // The second t.none call in each tx is the INSERT … VALUES ($1) with version.
  return dbMock._tx.none.mock.calls
    .filter((c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO schema_migrations'))
    .map((c) => c[1]?.[0]);
}

describe('runMigrations', () => {
  it('creates the schema_migrations table before applying anything', async () => {
    fsMock.readdirSync.mockReturnValue([]);
    dbMock.manyOrNone.mockResolvedValue([]);

    await runMigrations();

    expect(
      dbMock.none.mock.calls.some((c) => typeof c[0] === 'string' && c[0].includes('CREATE TABLE IF NOT EXISTS schema_migrations'))
    ).toBe(true);
  });

  it('applies only migrations not already recorded, in sorted order', async () => {
    fsMock.readdirSync.mockReturnValue(['002_b.sql', '001_baseline.sql', '003_c.sql', 'notes.txt']);
    dbMock.manyOrNone.mockResolvedValue([{ version: '001_baseline' }]); // 001 already applied

    await runMigrations();

    // 002 and 003 applied (txt ignored, 001 skipped), in order.
    expect(txVersions()).toEqual(['002_b', '003_c']);
    expect(dbMock.tx).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when every migration is already applied', async () => {
    fsMock.readdirSync.mockReturnValue(['001_baseline.sql']);
    dbMock.manyOrNone.mockResolvedValue([{ version: '001_baseline' }]);

    await runMigrations();

    expect(dbMock.tx).not.toHaveBeenCalled();
  });

  it('throws when the migrations directory is missing', async () => {
    fsMock.existsSync.mockReturnValue(false);

    await expect(runMigrations()).rejects.toThrow(/migrations directory not found/);
  });
});
