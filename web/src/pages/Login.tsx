import { useState } from 'react';
import { useAuthStore } from '../lib/auth';
import { auth } from '../lib/api';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((state) => state.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await auth.login(username, password);
      login(response.data.token, response.data.user);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
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
          <h1 className="text-4xl font-serif font-bold text-ink-900 mb-2">North Star</h1>
          <p className="text-ink-500">Your personal library</p>
        </div>

        {/* Login Form */}
        <div className="bg-parchment-50/80 backdrop-blur-sm rounded-2xl p-8 shadow-warm-lg border border-parchment-300">
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
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-ink-400">
            <p>Default credentials: admin / admin</p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-ink-400 text-sm mt-8">
          Designed and Built by Raina Corporation Limited.
        </p>
      </div>
    </div>
  );
}
