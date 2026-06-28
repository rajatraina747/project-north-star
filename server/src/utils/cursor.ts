// Keyset (cursor) pagination helpers shared by the books and search list
// endpoints. Unlike LIMIT/OFFSET — which re-scans and skips rows, getting slower
// and inconsistent as the library grows or changes between pages — keyset
// pagination seeks directly to the row after the previous page using a stable
// (sortKey, id) ordering. The cursor is an opaque token the client echoes back;
// it carries the last row's sort key and id so the next query can resume.

export interface Cursor {
  /** Text form of the previous page's last row sort key (its `keyExpr`). */
  k: string;
  /** UUID of that last row — the tiebreaker that makes the ordering unique. */
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encode a cursor as a URL-safe opaque token. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/**
 * Decode a cursor token. Returns null for anything malformed (bad base64,
 * non-JSON, wrong shape, or an id that isn't a UUID) so callers can safely fall
 * back to the first page instead of injecting a broken value into `::uuid`.
 */
export function decodeCursor(token: string | undefined | null): Cursor | null {
  if (!token) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { k, id } = parsed as Record<string, unknown>;
    if (typeof k !== 'string' || typeof id !== 'string' || !UUID_RE.test(id)) return null;
    return { k, id };
  } catch {
    return null;
  }
}

export type SortKey = 'title' | 'author' | 'recent' | 'added' | 'updated';

export interface SortSpec {
  /** SQL expression to sort by; also selected as the cursor key. Never NULL. */
  keyExpr: string;
  direction: 'ASC' | 'DESC';
  /** Cast applied to the cursor key param so it compares against `keyExpr`. */
  paramCast: string;
}

// Every key expression coalesces to a non-null value so the (keyExpr, id)
// ordering is total and keyset comparisons never hit NULL semantics. `b` is the
// books table alias both routes use.
export const SORT_SPECS: Record<SortKey, SortSpec> = {
  title: { keyExpr: "COALESCE(b.sort_title, b.title, '')", direction: 'ASC', paramCast: '' },
  author: {
    keyExpr:
      "COALESCE((SELECT MIN(a.sort_name) FROM authors a " +
      'INNER JOIN book_authors ba ON a.id = ba.author_id ' +
      "WHERE ba.book_id = b.id), '')",
    direction: 'ASC',
    paramCast: '',
  },
  recent: { keyExpr: 'b.created_at', direction: 'DESC', paramCast: '::timestamptz' },
  added: { keyExpr: 'b.created_at', direction: 'DESC', paramCast: '::timestamptz' },
  updated: { keyExpr: 'b.updated_at', direction: 'DESC', paramCast: '::timestamptz' },
};

export function resolveSort(sort: string | undefined, fallback: SortKey): SortSpec {
  return SORT_SPECS[(sort as SortKey)] ?? SORT_SPECS[fallback];
}

// Name of the selected cursor-key column. ORDER BY references this alias rather
// than repeating `keyExpr` so the query is valid under SELECT DISTINCT (whose
// ORDER BY items must appear in the select list) — the author sort key is a
// scalar subquery that would otherwise not match. Ordering by the text alias is
// consistent with the keyset comparison: for our text and timestamptz keys the
// text form sorts identically (the `+`/`.` separators in a timestamptz's text
// sort below any digit, so chronological order is preserved).
const CURSOR_KEY = '_cursor_key';

/** `ORDER BY` clause that matches the keyset comparison (key then id tiebreak). */
export function orderByClause(spec: SortSpec): string {
  return `${CURSOR_KEY} ${spec.direction}, b.id ${spec.direction}`;
}

/** Column to add to the SELECT so each row carries its cursor key as text. */
export function cursorKeySelect(spec: SortSpec): string {
  return `(${spec.keyExpr})::text AS ${CURSOR_KEY}`;
}

/**
 * Build the keyset WHERE fragment for resuming after `cursor`. `paramIndex` is
 * the next free positional parameter; the returned `values` (key, id) must be
 * appended to the query params in order. For ASC sorts we want rows strictly
 * after the cursor (`>`), for DESC strictly before (`<`); the id tiebreaker
 * matches that direction so the row-wise ordering stays consistent.
 */
export function keysetClause(
  spec: SortSpec,
  cursor: Cursor,
  paramIndex: number
): { clause: string; values: string[] } {
  const op = spec.direction === 'ASC' ? '>' : '<';
  const k = `$${paramIndex}${spec.paramCast}`;
  const id = `$${paramIndex + 1}::uuid`;
  const clause = `(${spec.keyExpr} ${op} ${k} OR (${spec.keyExpr} = ${k} AND b.id ${op} ${id}))`;
  return { clause, values: [cursor.k, cursor.id] };
}

/** A query row that carries the cursor key column added by `cursorKeySelect`. */
export type WithCursorKey<T> = T & { _cursor_key: string };

/**
 * Given the rows returned by a `LIMIT $limit + 1` keyset query, split off the
 * page and compute the next cursor. Returns the trimmed page (with `_cursor_key`
 * removed) and a `nextCursor` token, or null when there are no more rows.
 */
export function paginate<T extends { id: string }>(
  rows: WithCursorKey<T>[],
  limit: number
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const last = sliced[sliced.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ k: String(last._cursor_key), id: last.id }) : null;
  const page = sliced.map(({ _cursor_key, ...rest }) => rest as unknown as T);
  return { page, nextCursor };
}
