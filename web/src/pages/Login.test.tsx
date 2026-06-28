import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Login from './Login';
import { auth } from '../lib/api';

vi.mock('../lib/api', () => ({
  auth: {
    registrationStatus: vi.fn(() => Promise.resolve({ data: { open: false } })),
    login: vi.fn(),
    register: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

const mocked = vi.mocked(auth);

describe('Login password-reset flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.registrationStatus.mockResolvedValue({ data: { open: false } } as never);
    window.history.replaceState({}, '', '/');
  });

  it('requests a reset link and jumps to the reset form when a token is returned', async () => {
    mocked.forgotPassword.mockResolvedValue({
      data: { message: 'ok', reset_token: 'tok-123' },
    } as never);

    render(<Login />);
    // Wait for the sign-in form (registration status resolved).
    await screen.findByRole('button', { name: 'Sign In' });

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Username or email'), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(mocked.forgotPassword).toHaveBeenCalledWith('admin'));
    // The returned token prefills the reset form.
    const tokenField = (await screen.findByLabelText('Reset token')) as HTMLInputElement;
    expect(tokenField.value).toBe('tok-123');
  });

  it('submits a new password with the reset token', async () => {
    mocked.resetPassword.mockResolvedValue({ data: { message: 'Password updated.' } } as never);

    render(<Login />);
    await screen.findByRole('button', { name: 'Sign In' });

    fireEvent.click(screen.getByRole('button', { name: 'I have a reset token' }));
    fireEvent.change(screen.getByLabelText('Reset token'), { target: { value: 'tok-xyz' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'longenough' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(mocked.resetPassword).toHaveBeenCalledWith('tok-xyz', 'longenough'));
    // Returns to sign in with a confirmation message.
    expect(await screen.findByText('Password updated.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('auto-opens the reset form when the URL carries a token', async () => {
    window.history.replaceState({}, '', '/reset-password?token=url-token');
    render(<Login />);
    const tokenField = (await screen.findByLabelText('Reset token')) as HTMLInputElement;
    expect(tokenField.value).toBe('url-token');
  });
});
