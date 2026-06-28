import jwt from 'jsonwebtoken';
import { config } from './config';

// Short-lived, single-file access tickets. Reader libraries (pdf.js, epub.js)
// fetch book files via plain URLs and can't attach an Authorization header to
// their internal range requests. Instead the client first obtains a ticket
// (with the normal JWT) and embeds it in the file URL's query string. Tickets
// are scoped to one book+file and expire quickly, so leaking a URL exposes only
// that file for a few minutes rather than the bearer's full session.

const PURPOSE = 'file-access';
// Long enough to open a large PDF and stream it; short enough to limit exposure.
const TTL_SECONDS = 60 * 30; // 30 minutes

interface FileTicketPayload {
  purpose: typeof PURPOSE;
  uid: string;
  bid: string;
  fid: string;
}

export function signFileTicket(userId: string, bookId: string, fileId: string): string {
  const payload: FileTicketPayload = { purpose: PURPOSE, uid: userId, bid: bookId, fid: fileId };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: TTL_SECONDS });
}

/**
 * Returns true only if `token` is a valid, unexpired ticket issued for exactly
 * this book+file. Any verification failure (bad signature, expiry, wrong scope)
 * returns false rather than throwing.
 */
export function verifyFileTicket(token: string, bookId: string, fileId: string): boolean {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as Partial<FileTicketPayload>;
    return decoded.purpose === PURPOSE && decoded.bid === bookId && decoded.fid === fileId;
  } catch {
    return false;
  }
}
