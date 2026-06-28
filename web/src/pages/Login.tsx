import { useEffect, useState } from 'react';
import { useAuthStore } from '../lib/auth';
import { auth } from '../lib/api';

const inputClass =
  'w-full px-4 py-3 bg-parchment-50 border border-parchment-300 rounded-lg text-ink-900 placeholder-ink-300 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:border-transparent transition-all duration-250 ease-soft';
const buttonClass =
  'w-full bg-gradient-to-r from-ember-500 to-ember-600 text-cream font-semibold py-3 px-4 rounded-lg hover:from-ember-600 hover:to-ember-700 focus:outline-none focus:ring-2 focus:ring-ember-500 focus:ring-offset-2 focus:ring-offset-parchment-50 transition-all duration-250 ease-soft disabled:opacity-50 disabled:cursor-not-allowed shadow-warm';

// 'auth' = sign-in / first-run admin creation; 'forgot' = request a reset link;
// 'reset' = complete a reset with a token.
type Mode = 'auth' | 'forgot' | 'reset';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mode, setMode] = useState<Mode>('auth');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  // null = still checking; true = no users yet (show first-run admin setup).
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null);
  const login = useAuthStore((state) => state.login);

  useEffect(() => {
    auth
      .registrationStatus()
      .then((res) => setRegistrationOpen(res.data.open))
      .catch(() => setRegistrationOpen(false));
    // The emailed/logged reset link points at /reset-password?token=… — if we
    // land here with a token, jump straight to the reset form.
    const token = new URLSearchParams(window.location.search).get('token');
    if (token) {
      setResetToken(token);
      setMode('reset');
    }
  }, []);

  const isFirstRun = registrationOpen === true;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setInfo('');
  };

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
        login(response.data.token, response.data.refresh_token, response.data.user);
      } else {
        const response = await auth.login(username, password);
        login(response.data.token, response.data.refresh_token, response.data.user);
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

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await auth.forgotPassword(identifier);
      setInfo(res.data.message);
      // For no-email setups the server may return the token directly — prefill it.
      if (res.data.reset_token) {
        setResetToken(res.data.reset_token);
        setMode('reset');
        setInfo('A reset token was generated. Enter a new password below.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not start password reset.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await auth.resetPassword(resetToken, newPassword);
      setNewPassword('');
      setMode('auth');
      setInfo(res.data.message);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Could not reset password.');
    } finally {
      setLoading(false);
    }
  };

  const subtitle =
    mode === 'forgot'
      ? 'Reset your password'
      : mode === 'reset'
        ? 'Choose a new password'
        : isFirstRun
          ? 'Create the first administrator account'
          : 'Your personal library';

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
          <p className="text-ink-500">{subtitle}</p>
        </div>

        <div className="bg-parchment-50/80 backdrop-blur-sm rounded-2xl p-8 shadow-warm-lg border border-parchment-300">
          {isFirstRun && mode === 'auth' && (
            <div className="mb-6 bg-ember-500/10 border border-ember-500/30 rounded-lg p-3 text-sm text-ink-700">
              No accounts exist yet. The account you create here becomes the
              administrator, and sign-up is then closed.
            </div>
          )}

          {info && (
            <div className="mb-6 bg-green-600/10 border border-green-600/30 rounded-lg p-3 text-sm text-green-800">
              {info}
            </div>
          )}

          {/* Sign-in / first-run admin form */}
          {mode === 'auth' && (
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
                  className={inputClass}
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
                      className={inputClass}
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
                      className={inputClass}
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
                  className={inputClass}
                  placeholder="Enter your password"
                  required
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className={buttonClass}>
                {loading
                  ? isFirstRun
                    ? 'Creating account...'
                    : 'Signing in...'
                  : isFirstRun
                    ? 'Create Admin Account'
                    : 'Sign In'}
              </button>

              {!isFirstRun && (
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={() => switchMode('forgot')}
                    className="text-ember-700 hover:text-ember-800 font-medium"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('reset')}
                    className="text-ink-400 hover:text-ink-600"
                  >
                    I have a reset token
                  </button>
                </div>
              )}
            </form>
          )}

          {/* Request a reset link */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgot} className="space-y-6">
              <div>
                <label htmlFor="identifier" className="block text-sm font-medium text-ink-700 mb-2">
                  Username or email
                </label>
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className={inputClass}
                  placeholder="Enter your username or email"
                  required
                  autoFocus
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className={buttonClass}>
                {loading ? 'Sending...' : 'Send reset link'}
              </button>
              <button
                type="button"
                onClick={() => switchMode('auth')}
                className="w-full text-sm text-ink-400 hover:text-ink-600"
              >
                Back to sign in
              </button>
            </form>
          )}

          {/* Complete a reset with a token */}
          {mode === 'reset' && (
            <form onSubmit={handleReset} className="space-y-6">
              <div>
                <label htmlFor="reset_token" className="block text-sm font-medium text-ink-700 mb-2">
                  Reset token
                </label>
                <input
                  id="reset_token"
                  type="text"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className={inputClass}
                  placeholder="Paste the token from your reset link"
                  required
                />
              </div>
              <div>
                <label htmlFor="new_password" className="block text-sm font-medium text-ink-700 mb-2">
                  New password
                </label>
                <input
                  id="new_password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputClass}
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className={buttonClass}>
                {loading ? 'Updating...' : 'Set new password'}
              </button>
              <button
                type="button"
                onClick={() => switchMode('auth')}
                className="w-full text-sm text-ink-400 hover:text-ink-600"
              >
                Back to sign in
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-ink-400 text-sm mt-8">
          Designed and Built by Raina Corporation Limited.
        </p>
      </div>
    </div>
  );
}
