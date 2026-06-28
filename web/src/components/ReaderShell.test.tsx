import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReaderShell from './ReaderShell';

const baseProps = {
  title: 'Test Book',
  onBack: () => {},
  onPrev: () => {},
  onNext: () => {},
  toc: [{ label: 'Chapter One', href: 'chapter1.xhtml' }],
};

describe('ReaderShell sidebar focus management', () => {
  it('moves focus into the panel on open and restores it to the trigger on close', () => {
    render(<ReaderShell {...baseProps}>content</ReaderShell>);

    const toggle = screen.getByRole('button', { name: 'Toggle contents' });
    toggle.focus();
    fireEvent.click(toggle);

    const panel = screen.getByRole('complementary', { name: 'Reader navigation' });
    expect(panel).toContainElement(document.activeElement as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(document.activeElement).toBe(toggle);
  });

  it('keeps the closed panel out of the tab order via inert', () => {
    render(<ReaderShell {...baseProps}>content</ReaderShell>);
    // The aside is rendered but inert while closed.
    const aside = document.querySelector('aside[aria-label="Reader navigation"]') as HTMLElement;
    expect(aside).toBeTruthy();
    expect(aside.inert).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle contents' }));
    expect(aside.inert).toBe(false);
  });
});
