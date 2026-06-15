import { useEffect, useState } from 'react';
import { useAuthStore } from '../lib/auth';
import { auth } from '../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // null = still checking; true = no users yet (show first-run admin setup).
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const login = useAuthStore((state) => state.login);

  useEffect(() => {
    auth
      .registrationStatus()
      .then((res) => setRegistrationOpen(res.data.open))
      .catch(() => setRegistrationOpen(false));
  }, []);

  const isFirstRun = registrationOpen === true;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isFirstRun) {
        const response = await auth.register({
          username,
          email,
          password,
          display_name: displayName || username,
        });
        login(response.data.token, response.data.user);
      } else {
        const response = await auth.login(username, password);
        login(response.data.token, response.data.user);
      }
    } catch (err: any) {
      setError(
        err.response?.data?.error ||
          (isFirstRun ? 'Could not create admin account.' : 'Login failed. Please try again.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-parchment-100 via-parchment-50 to-parchment-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-ember-500 to-ember-700 rounded-2xl mb-4 shadow-warm-lg">
            <svg className="w-10 h-10 text-cream" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-4xl font-serif font-bold text-ink-900 mb-2">Project North Star</h1>
          <p className="text-ink-500">
            {isFirstRun ? 'Create the first administrator account' : 'Your personal library'}
          </p>
        </div>

        {/* Login / First-run Form */}
        <div className="bg-parchment-50/80 backdrop-blur-sm rounded-2xl p-8 shadow-warm-lg border border-parchment-300">
          {isFirstRun && (
            <div className="mb-6 bg-ember-500/10 border border-ember-500/30 rounded-lg p-3 text-sm text-ink-700">
              No accounts exist yet. The account you create here becomes the
              administrator, and sign-up is then closed.
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-ink-700 mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-parchment-50 border border-parchment-300 rounded-lg text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:border-transparent transition-all duration-250 ease-soft"
                placeholder="Enter your username"
                required
                autoFocus
              />
            </div>

            {isFirstRun && (
              <>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-ink-700 mb-2">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-parchment-50 border border-parchment-300 rounded-lg text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:border-transparent transition-all duration-250 ease-soft"
                    placeholder="you@example.com"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="display_name" className="block text-sm font-medium text-ink-700 mb-2">
                    Display name <span className="text-ink-400 font-normal">(optional)</span>
                  </label>
                  <input
                    id="display_name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-4 py-3 bg-parchment-50 border border-parchment-300 rounded-lg text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:border-transparent transition-all duration-250 ease-soft"
                    placeholder="How your name appears"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink-700 mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-parchment-50 border border-parchment-300 rounded-lg text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:border-transparent transition-all duration-250 ease-soft"
                placeholder="Enter your password"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-ember-500 to-ember-600 text-cream font-semibold py-3 px-4 rounded-lg hover:from-ember-600 hover:to-ember-700 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:ring-offset-2 focus:ring-offset-parchment-50 transition-all duration-250 ease-soft disabled:opacity-50 disabled:cursor-not-allowed shadow-warm"
            >
              {loading
                ? isFirstRun
                  ? 'Creating account...'
                  : 'Signing in...'
                : isFirstRun
                  ? 'Create Admin Account'
                  : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-ink-400 text-sm mt-8">
          Designed and Built by Raina Corporation Limited.
        </p>
      </div>
    </div>
  );
}
