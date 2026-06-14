import { useThemeStore, type ThemeMode } from '../lib/theme';

const options: { mode: ThemeMode; label: string; icon: JSX.Element }[] = [
  {
    mode: 'light',
    label: 'Light',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
  },
  {
    mode: 'system',
    label: 'System',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    mode: 'dark',
    label: 'Dark',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
      </svg>
    ),
  },
];

export default function ThemeToggle() {
  const { mode, setMode } = useThemeStore();

  return (
    <div className="flex items-center gap-0.5 bg-parchment-200/70 rounded-lg p-0.5 border border-parchment-300">
      {options.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          onClick={() => setMode(opt.mode)}
          title={opt.label}
          aria-label={`${opt.label} theme`}
          aria-pressed={mode === opt.mode}
          className={`flex-1 flex items-center justify-center py-1.5 rounded-md transition-all duration-250 ease-soft ${
            mode === opt.mode
              ? 'bg-parchment-50 text-ember-600 shadow-warm'
              : 'text-ink-400 hover:text-ink-700'
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
