import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

// Inline the secret in the factory — vi.mock is hoisted above top-level consts.
vi.mock('../utils/config', () => ({ config: { jwtSecret: 'test-secret-for-file-tickets' } }));
const SECRET = 'test-secret-for-file-tickets';

import { signFileTicket, verifyFileTicket } from '../utils/file-ticket';

describe('file tickets', () => {
  it('verifies a ticket for the exact book + file it was issued for', () => {
    const token = signFileTicket('user-1', 'book-1', 'file-1');
    expect(verifyFileTicket(token, 'book-1', 'file-1')).toBe(true);
  });

  it('rejects a ticket used for a different file or book', () => {
    const token = signFileTicket('user-1', 'book-1', 'file-1');
    expect(verifyFileTicket(token, 'book-1', 'file-2')).toBe(false);
    expect(verifyFileTicket(token, 'book-2', 'file-1')).toBe(false);
  });

  it('rejects garbage and empty tokens', () => {
    expect(verifyFileTicket('not-a-jwt', 'book-1', 'file-1')).toBe(false);
    expect(verifyFileTicket('', 'book-1', 'file-1')).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ purpose: 'file-access', uid: 'u', bid: 'book-1', fid: 'file-1' }, 'wrong-secret');
    expect(verifyFileTicket(forged, 'book-1', 'file-1')).toBe(false);
  });

  it('rejects an expired ticket', () => {
    const expired = jwt.sign(
      { purpose: 'file-access', uid: 'u', bid: 'book-1', fid: 'file-1' },
      SECRET,
      { expiresIn: -10 }
    );
    expect(verifyFileTicket(expired, 'book-1', 'file-1')).toBe(false);
  });

  it('rejects a valid JWT that is not a file-access ticket', () => {
    const wrongPurpose = jwt.sign({ purpose: 'login', bid: 'book-1', fid: 'file-1' }, SECRET);
    expect(verifyFileTicket(wrongPurpose, 'book-1', 'file-1')).toBe(false);
  });
});
