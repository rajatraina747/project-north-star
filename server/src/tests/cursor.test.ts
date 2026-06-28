import { describe, it, expect } from 'vitest';
import {
  encodeCursor,
  decodeCursor,
  resolveSort,
  orderByClause,
  cursorKeySelect,
  keysetClause,
  paginate,
  SORT_SPECS,
  WithCursorKey,
} from '../utils/cursor';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

describe('cursor encode/decode', () => {
  it('round-trips a cursor through an opaque token', () => {
    const token = encodeCursor({ k: 'The Hobbit', id: UUID_A });
    expect(token).not.toContain('Hobbit'); // opaque, not human-readable
    expect(decodeCursor(token)).toEqual({ k: 'The Hobbit', id: UUID_A });
  });

  it('preserves unicode and punctuation in the sort key', () => {
    const token = encodeCursor({ k: 'Émile · 日本語', id: UUID_A });
    expect(decodeCursor(token)).toEqual({ k: 'Émile · 日本語', id: UUID_A });
  });

  it('returns null for empty, malformed, or non-cursor tokens', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('not-base64-$$$')).toBeNull();
    expect(decodeCursor(Buffer.from('not json', 'utf8').toString('base64url'))).toBeNull();
    expect(decodeCursor(encodeCursor({ k: 'x', id: 'not-a-uuid' }))).toBeNull();
    // missing fields
    expect(decodeCursor(Buffer.from('{"k":"x"}', 'utf8').toString('base64url'))).toBeNull();
  });
});

describe('sort specs', () => {
  it('falls back to the given default for unknown sorts', () => {
    expect(resolveSort('bogus', 'title')).toBe(SORT_SPECS.title);
    expect(resolveSort(undefined, 'recent')).toBe(SORT_SPECS.recent);
    expect(resolveSort('author', 'title')).toBe(SORT_SPECS.author);
  });

  it('orders by the cursor-key alias then id in the same direction', () => {
    // References the selected alias (not the raw expr) to stay valid under
    // SELECT DISTINCT.
    expect(orderByClause(SORT_SPECS.title)).toBe('_cursor_key ASC, b.id ASC');
    expect(orderByClause(SORT_SPECS.recent)).toBe('_cursor_key DESC, b.id DESC');
  });

  it('selects the key as text under the _cursor_key alias', () => {
    expect(cursorKeySelect(SORT_SPECS.recent)).toBe('(b.created_at)::text AS _cursor_key');
  });
});

describe('keyset clause', () => {
  it('seeks strictly forward for ASC sorts with an id tiebreaker', () => {
    const { clause, values } = keysetClause(SORT_SPECS.title, { k: 'M', id: UUID_A }, 3);
    expect(clause).toBe(
      "(COALESCE(b.sort_title, b.title, '') > $3 OR " +
        "(COALESCE(b.sort_title, b.title, '') = $3 AND b.id > $4::uuid))"
    );
    expect(values).toEqual(['M', UUID_A]);
  });

  it('seeks strictly backward for DESC sorts and casts the key param', () => {
    const { clause } = keysetClause(SORT_SPECS.recent, { k: '2020-01-01', id: UUID_B }, 1);
    expect(clause).toBe(
      '(b.created_at < $1::timestamptz OR ' +
        '(b.created_at = $1::timestamptz AND b.id < $2::uuid))'
    );
  });
});

describe('paginate', () => {
  type Row = WithCursorKey<{ id: string; title: string }>;
  const rows: Row[] = [
    { id: UUID_A, title: 'A', _cursor_key: 'A' },
    { id: UUID_B, title: 'B', _cursor_key: 'B' },
    { id: '33333333-3333-3333-3333-333333333333', title: 'C', _cursor_key: 'C' },
  ];

  it('trims the extra look-ahead row and emits a next cursor', () => {
    const { page, nextCursor } = paginate(rows, 2);
    expect(page.map((r) => r.title)).toEqual(['A', 'B']);
    expect(page[0]).not.toHaveProperty('_cursor_key');
    expect(nextCursor).not.toBeNull();
    expect(decodeCursor(nextCursor)).toEqual({ k: 'B', id: UUID_B });
  });

  it('returns no cursor when the page is not full', () => {
    const { page, nextCursor } = paginate(rows.slice(0, 2), 2);
    expect(page).toHaveLength(2);
    expect(nextCursor).toBeNull();
  });

  it('handles an empty result set', () => {
    expect(paginate([], 10)).toEqual({ page: [], nextCursor: null });
  });
});
