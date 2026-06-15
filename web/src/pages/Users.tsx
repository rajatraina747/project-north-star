import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { users as usersApi, type AdminUser } from '../lib/api';
import { useAuthStore } from '../lib/auth';

export default function Users() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.list()).data,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const onError = (e: any) => setError(e.response?.data?.error || 'Action failed');

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof usersApi.update>[1] }) =>
      usersApi.update(id, patch),
    onSuccess: () => { setError(null); invalidate(); },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => { setError(null); invalidate(); },
    onError,
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => usersApi.resetPassword(id, password),
    onSuccess: () => { setError(null); },
    onError,
  });

  const users = data || [];

  return (
    <div className="min-h-screen">
      <div className="bg-parchment-100/70 border-b border-parchment-300">
        <div className="max-w-5xl mx-auto px-8 py-6">
          <Link to="/admin" className="text-sm text-ink-400 hover:text-ember-700">← Back to Admin</Link>
          <h1 className="text-3xl font-serif font-bold text-ink-900 mt-2">User Management</h1>
          <p className="text-ink-500 mt-1">Create accounts, manage roles, and control access</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {error && (
          <div className="p-4 rounded-lg bg-red-600/10 border border-red-600/30 text-red-800">{error}</div>
        )}

        <CreateUserForm onError={setError} onCreated={() => { setError(null); invalidate(); }} />

        <div className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6">
          <h2 className="text-xl font-serif font-semibold text-ink-900 mb-4">Users</h2>
          {isLoading ? (
            <p className="text-ink-400 py-6 text-center">Loading…</p>
          ) : (
            <div className="space-y-3">
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  u={u}
                  isSelf={u.id === currentUser?.id}
                  onUpdate={(patch) => updateMutation.mutate({ id: u.id, patch })}
                  onDelete={() => {
                    if (window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) {
                      deleteMutation.mutate(u.id);
                    }
                  }}
                  onReset={() => {
                    const pw = window.prompt(`New password for "${u.username}" (min 6 chars):`);
                    if (pw) resetMutation.mutate({ id: u.id, password: pw });
                  }}
                  busy={updateMutation.isPending || deleteMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserRow({
  u,
  isSelf,
  onUpdate,
  onDelete,
  onReset,
  busy,
}: {
  u: AdminUser;
  isSelf: boolean;
  onUpdate: (patch: { is_admin?: boolean; is_active?: boolean }) => void;
  onDelete: () => void;
  onReset: () => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-4 bg-parchment-50 rounded-lg border border-parchment-300">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-ember-500 to-ember-700 flex items-center justify-center text-cream text-sm font-bold flex-shrink-0">
          {u.username.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-ink-900 font-medium truncate">{u.display_name || u.username}</p>
            {u.is_admin && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-ember-500/15 text-ember-700 border border-ember-500/30 rounded">ADMIN</span>
            )}
            {!u.is_active && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-600/12 text-red-700 border border-red-600/25 rounded">DISABLED</span>
            )}
          </div>
          <p className="text-xs text-ink-400 truncate">{u.username} · {u.email}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          disabled={busy || isSelf}
          onClick={() => onUpdate({ is_admin: !u.is_admin })}
          title={isSelf ? 'You cannot change your own role' : ''}
          className="px-2.5 py-1.5 text-xs font-medium bg-parchment-200 hover:bg-parchment-300 text-ink-700 border border-parchment-300 rounded-lg transition-colors disabled:opacity-40"
        >
          {u.is_admin ? 'Revoke admin' : 'Make admin'}
        </button>
        <button
          type="button"
          disabled={busy || isSelf}
          onClick={() => onUpdate({ is_active: !u.is_active })}
          title={isSelf ? 'You cannot disable yourself' : ''}
          className="px-2.5 py-1.5 text-xs font-medium bg-parchment-200 hover:bg-parchment-300 text-ink-700 border border-parchment-300 rounded-lg transition-colors disabled:opacity-40"
        >
          {u.is_active ? 'Disable' : 'Enable'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onReset}
          className="px-2.5 py-1.5 text-xs font-medium bg-parchment-200 hover:bg-parchment-300 text-ink-700 border border-parchment-300 rounded-lg transition-colors disabled:opacity-40"
        >
          Reset password
        </button>
        <button
          type="button"
          disabled={busy || isSelf}
          onClick={onDelete}
          title={isSelf ? 'You cannot delete yourself' : ''}
          className="px-2.5 py-1.5 text-xs font-medium bg-red-600/10 hover:bg-red-600/20 text-red-700 border border-red-600/25 rounded-lg transition-colors disabled:opacity-40"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateUserForm({ onCreated, onError }: { onCreated: () => void; onError: (msg: string) => void }) {
  const [form, setForm] = useState({ username: '', email: '', display_name: '', password: '', is_admin: false });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const createMutation = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: () => {
      setForm({ username: '', email: '', display_name: '', password: '', is_admin: false });
      onCreated();
    },
    onError: (e: any) => onError(e.response?.data?.error || 'Failed to create user'),
  });

  const inputClass = 'w-full px-3 py-2 text-sm bg-parchment-50 border border-parchment-300 rounded-lg text-ink-900 focus:outline-none focus:ring-1 focus:ring-ember-500/60';

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }}
      className="bg-parchment-100/70 rounded-xl border border-parchment-300 p-6"
    >
      <h2 className="text-xl font-serif font-semibold text-ink-900 mb-4">Add User</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <input className={inputClass} placeholder="Username" value={form.username} onChange={set('username')} required />
        <input className={inputClass} type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
        <input className={inputClass} placeholder="Display name (optional)" value={form.display_name} onChange={set('display_name')} />
        <input className={inputClass} type="password" placeholder="Initial password (min 6)" value={form.password} onChange={set('password')} required minLength={6} />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={form.is_admin} onChange={set('is_admin')} className="w-4 h-4 accent-ember-500" />
          Grant administrator role
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="px-5 py-2 bg-ember-500 hover:bg-ember-600 text-cream text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating…' : 'Create User'}
        </button>
      </div>
    </form>
  );
}
