const DAY_MS = 86_400_000;
const toKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Compute the current and longest reading streaks from a set of active-day keys
 * (YYYY-MM-DD). The current streak counts consecutive days up to today (or
 * yesterday, so a day isn't "lost" until fully missed); the longest streak is
 * the maximum consecutive run anywhere in the history.
 */
export function computeStreaks(dayKeys: string[], today: Date = new Date()): { current: number; longest: number } {
  const daySet = new Set(dayKeys.map((k) => k.slice(0, 10)));

  // Current streak.
  let current = 0;
  const cursor = new Date(today);
  if (daySet.has(toKey(cursor)) || daySet.has(toKey(new Date(cursor.getTime() - DAY_MS)))) {
    if (!daySet.has(toKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (daySet.has(toKey(cursor))) {
      current++;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  // Longest streak: walk the sorted days, counting consecutive runs.
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const key of [...daySet].sort()) {
    const t = new Date(`${key}T00:00:00Z`).getTime();
    run = prev !== null && t - prev === DAY_MS ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = t;
  }

  return { current, longest };
}
