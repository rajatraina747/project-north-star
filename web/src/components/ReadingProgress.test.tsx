import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReadingProgress from './ReadingProgress';

describe('ReadingProgress', () => {
  it('renders a rounded percentage label by default', () => {
    render(<ReadingProgress progress={42.6} />);
    expect(screen.getByText('43% complete')).toBeInTheDocument();
  });

  it('clamps the bar width to the 0–100 range', () => {
    const { container, rerender } = render(<ReadingProgress progress={150} />);
    const bar = container.querySelector('[style*="width"]') as HTMLElement;
    expect(bar.style.width).toBe('100%');

    rerender(<ReadingProgress progress={-20} />);
    const bar2 = container.querySelector('[style*="width"]') as HTMLElement;
    expect(bar2.style.width).toBe('0%');
  });

  it('hides the percentage when showPercentage is false', () => {
    render(<ReadingProgress progress={50} showPercentage={false} />);
    expect(screen.queryByText(/complete/)).not.toBeInTheDocument();
  });

  it('renders a relative last-read label when requested', () => {
    render(<ReadingProgress progress={10} showLastRead lastRead={new Date()} />);
    expect(screen.getByText('Today')).toBeInTheDocument();
  });
});
