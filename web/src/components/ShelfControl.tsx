import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { shelf as shelfApi } from '../lib/api';
import type { ShelfStatus } from '../types';

const OPTIONS: { value: ShelfStatus; label: string }[] = [
  { value: 'WANT_TO_READ', label: 'Want to Read' },
  { value: 'READING', label: 'Reading' },
  { value: 'FINISHED', label: 'Finished' },
];

/**
 * Per-user shelf selector. FINISHED stays in sync with the "Mark as Finished"
 * flag server-side, so invalidating the related queries keeps the rest of the
 * BookDetail page (finished badge / button) consistent.
 */
export default function ShelfControl({ bookId }: { bookId: string }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['shelf', bookId],
    queryFn: async () => (await shelfApi.get(bookId)).data,
  });
  const current = data?.status ?? null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['shelf', bookId] });
    queryClient.invalidateQueries({ queryKey: ['shelf'] });
    queryClient.invalidateQueries({ queryKey: ['progress-meta', bookId] });
    queryClient.invalidateQueries({ queryKey: ['continue-reading'] });
  };

  const setMutation = useMutation({
    mutationFn: (status: ShelfStatus) => shelfApi.set(bookId, status),
    onSuccess: invalidate,
  });
  const removeMutation = useMutation({
    mutationFn: () => shelfApi.remove(bookId),
    onSuccess: invalidate,
  });

  const busy = setMutation.isPending || removeMutation.isPending;

  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-parchment-300 bg-parchment-100 p-0.5">
      {OPTIONS.map((opt) => {
        const active = current === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={busy}
            onClick={() => (active ? removeMutation.mutate() : setMutation.mutate(opt.value))}
            title={active ? 'Click to remove from shelf' : `Mark as ${opt.label}`}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-50 ${
              active
                ? 'bg-ember-500 text-cream'
                : 'text-ink-600 hover:bg-parchment-200'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
