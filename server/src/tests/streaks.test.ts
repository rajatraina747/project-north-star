import { describe, it, expect } from 'vitest';
import { computeStreaks } from '../utils/streaks';

const TODAY = new Date('2026-06-28T12:00:00Z');
const d = (s: string) => s; // readability helper

describe('computeStreaks', () => {
  it('returns zeros for no activity', () => {
    expect(computeStreaks([], TODAY)).toEqual({ current: 0, longest: 0 });
  });

  it('counts a current streak ending today', () => {
    const days = ['2026-06-26', '2026-06-27', '2026-06-28'];
    expect(computeStreaks(days, TODAY)).toEqual({ current: 3, longest: 3 });
  });

  it('still counts the current streak if the last active day was yesterday', () => {
    const days = ['2026-06-26', '2026-06-27'];
    expect(computeStreaks(days, TODAY).current).toBe(2);
  });

  it('resets the current streak once a full day is missed', () => {
    const days = ['2026-06-24', '2026-06-25']; // gap before yesterday
    expect(computeStreaks(days, TODAY).current).toBe(0);
  });

  it('finds the longest run even when it is not current', () => {
    const days = [
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', // run of 4
      '2026-06-10',
      d('2026-06-28'), // today, run of 1
    ];
    const { current, longest } = computeStreaks(days, TODAY);
    expect(longest).toBe(4);
    expect(current).toBe(1);
  });

  it('de-duplicates repeated day keys', () => {
    expect(computeStreaks(['2026-06-28', '2026-06-28'], TODAY)).toEqual({ current: 1, longest: 1 });
  });
});
