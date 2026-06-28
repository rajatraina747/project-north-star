import { progress as progressApi } from './api';
import type { ReadingProgress } from '../types';
import {
  enqueueProgress,
  getQueuedProgress,
  removeQueuedProgress,
} from './offline';

// Offline-aware reading-progress sync. Readers call saveProgress() instead of
// hitting the API directly: when the network is unavailable the update is queued
// in IndexedDB and replayed once the connection returns.

type ProgressPayload = Partial<ReadingProgress>;

/** Send a progress update, queueing it for later if the request fails. */
export async function saveProgress(
  bookId: string,
  fileId: string,
  payload: ProgressPayload
): Promise<void> {
  try {
    await progressApi.update(bookId, fileId, payload);
  } catch {
    await enqueueProgress({
      id: `${bookId}:${fileId}`,
      bookId,
      fileId,
      payload: payload as Record<string, unknown>,
      queuedAt: Date.now(),
    }).catch(() => undefined);
  }
}

let flushing = false;

/** Replay any queued progress updates, stopping early if we're still offline. */
export async function flushProgressQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const items = await getQueuedProgress().catch(() => []);
    for (const item of items) {
      try {
        await progressApi.update(item.bookId, item.fileId, item.payload as ProgressPayload);
        await removeQueuedProgress(item.id);
      } catch {
        // Still unreachable — leave this and the rest queued for next time.
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

/** Wire up automatic flushing: on app load and whenever connectivity returns. */
export function initProgressSync(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    void flushProgressQueue();
  });
  void flushProgressQueue();
}
