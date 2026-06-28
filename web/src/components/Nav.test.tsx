import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Nav from './Nav';
import { useAuthStore } from '../lib/auth';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
    </MemoryRouter>
  );

describe('Nav accessibility', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', username: 'a', email: 'a@b.c', display_name: 'A', is_admin: true } as never,
    });
  });

  it('exposes a labelled primary navigation landmark', () => {
    renderAt('/');
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });

  it('marks the active route link with aria-current="page"', () => {
    renderAt('/library');
    expect(screen.getByRole('link', { name: 'Library' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('treats nested routes as active for the section link', () => {
    renderAt('/authors/123');
    expect(screen.getByRole('link', { name: 'Authors' })).toHaveAttribute('aria-current', 'page');
  });
});
