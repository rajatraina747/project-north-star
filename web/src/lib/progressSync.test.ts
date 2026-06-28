import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { saveProgress, flushProgressQueue } from './progressSync';
import { getQueuedProgress, _clearForTests } from './offline';
import { progress as progressApi } from './api';

vi.mock('./api', () => ({ progress: { update: vi.fn() } }));

const update = vi.mocked(progressApi.update);

beforeEach(async () => {
  await _clearForTests();
  vi.clearAllMocks();
});

describe('saveProgress', () => {
  it('sends to the API when online and queues nothing', async () => {
    update.mockResolvedValueOnce({} as never);
    await saveProgress('b1', 'f1', { progress_percent: 50 });
    expect(update).toHaveBeenCalledWith('b1', 'f1', { progress_percent: 50 });
    expect(await getQueuedProgress()).toHaveLength(0);
  });

  it('queues the update when the API call fails', async () => {
    update.mockRejectedValueOnce(new Error('offline'));
    await saveProgress('b1', 'f1', { progress_percent: 50 });
    const queued = await getQueuedProgress();
    expect(queued).toHaveLength(1);
    expect(queued[0].bookId).toBe('b1');
  });
});

describe('flushProgressQueue', () => {
  it('replays and clears queued updates once back online', async () => {
    update.mockRejectedValueOnce(new Error('offline'));
    await saveProgress('b1', 'f1', { progress_percent: 50 });
    expect(await getQueuedProgress()).toHaveLength(1);

    update.mockResolvedValue({} as never);
    await flushProgressQueue();
    expect(await getQueuedProgress()).toHaveLength(0);
  });

  it('keeps items queued while still offline', async () => {
    update.mockRejectedValue(new Error('offline'));
    await saveProgress('b1', 'f1', { progress_percent: 50 });
    await flushProgressQueue();
    expect(await getQueuedProgress()).toHaveLength(1);
  });
});
