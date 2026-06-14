import { describe, it, expect } from 'vitest';
import path from 'path';
import { resolveWithin } from '../routes/books';

describe('resolveWithin', () => {
  const base = '/data/books';

  it('returns the resolved path for a safe relative path', () => {
    const result = resolveWithin(base, 'author/book.epub');
    expect(result).toBe(path.resolve(base, 'author/book.epub'));
  });

  it('returns null for a classic ../ traversal', () => {
    expect(resolveWithin(base, '../../../etc/passwd')).toBeNull();
  });

  it('treats percent-encoded slashes as literal characters (no traversal)', () => {
    // path.resolve does NOT decode %2F — it is passed to the OS verbatim.
    // The filesystem sees a filename containing the literal characters "..%2F",
    // which stays inside the base, so resolveWithin returns a non-null path.
    const result = resolveWithin(base, '..%2F..%2Fetc%2Fpasswd');
    expect(result).not.toBeNull();
    // And it must still be inside the base
    expect(result!.startsWith(path.resolve(base) + path.sep)).toBe(true);
  });

  it('returns null for an absolute path that is outside the base', () => {
    expect(resolveWithin(base, '/etc/passwd')).toBeNull();
  });

  it('returns the base path itself when given an empty string', () => {
    // resolveWithin only rejects if the result escapes the base; the base
    // directory itself is allowed (needed for directory-level access checks).
    const result = resolveWithin(base, '');
    // path.resolve(base, '') === base
    expect(result).toBe(path.resolve(base));
  });

  it('returns null for a dot-dot path that only partially overlaps base name', () => {
    // Ensure prefix collision is handled: /data/books-evil should not match /data/books
    const result = resolveWithin('/data/books', '../books-evil/secret');
    expect(result).toBeNull();
  });

  it('allows deep nested paths within the base', () => {
    const result = resolveWithin(base, 'series/vol1/chapter1.pdf');
    expect(result).toBe(path.resolve(base, 'series/vol1/chapter1.pdf'));
  });
});
