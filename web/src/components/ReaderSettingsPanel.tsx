import { useEffect, useRef, useState } from 'react';
import type { ReaderSettings, ReaderFontFamily, ReaderTheme } from '../lib/readerSettings';

interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  // PDFs render to a canvas, so font family / line height / justification don't
  // apply. When true those controls are hidden and only theme + margin show.
  pdf?: boolean;
}

const FONT_OPTIONS: { value: ReaderFontFamily; label: string }[] = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
  { value: 'dyslexic', label: 'Dyslexic' },
];

const THEME_OPTIONS: { value: ReaderTheme; label: string; swatch: string }[] = [
  { value: 'light', label: 'Light', swatch: '#f5f0e6' },
  { value: 'sepia', label: 'Sepia', swatch: '#f4ecd8' },
  { value: 'night', label: 'Night', swatch: '#1a1410' },
];

export default function ReaderSettingsPanel({ settings, onChange, pdf }: ReaderSettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`p-2 rounded-lg transition-colors ${open ? 'bg-parchment-300 text-ink-900' : 'bg-parchment-200 text-ink-500 hover:text-ink-900'}`}
        title="Display settings"
        aria-label="Display settings"
      >
        {/* "Aa" glyph */}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 19l5-13 5 13M6.5 14h5M16 19l2.5-7 2.5 7m-4.2-2.2h3.4" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-parchment-300 shadow-warm-lg p-4 space-y-4"
          style={{ backgroundColor: 'rgb(var(--p-50))' }}
        >
          {/* Theme */}
          <div>
            <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Page theme</p>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => onChange({ theme: t.value })}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg border text-xs transition-all ${
                    settings.theme === t.value
                      ? 'border-ember-500 ring-1 ring-ember-500/40 text-ink-900'
                      : 'border-parchment-300 text-ink-500 hover:bg-parchment-200'
                  }`}
                >
                  <span className="w-6 h-6 rounded-full border border-parchment-400" style={{ backgroundColor: t.swatch }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Font size (EPUB) / zoom (PDF) */}
          <Slider
            label={pdf ? 'Zoom' : 'Font size'}
            value={settings.fontSize}
            min={80}
            max={200}
            step={10}
            suffix="%"
            onChange={(v) => onChange({ fontSize: v })}
          />

          {!pdf && (
            <>
              {/* Font family */}
              <div>
                <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide mb-1.5">Font</p>
                <div className="grid grid-cols-3 gap-2">
                  {FONT_OPTIONS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => onChange({ fontFamily: f.value })}
                      className={`py-1.5 rounded-lg border text-xs transition-all ${
                        settings.fontFamily === f.value
                          ? 'border-ember-500 ring-1 ring-ember-500/40 text-ink-900'
                          : 'border-parchment-300 text-ink-500 hover:bg-parchment-200'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <Slider
                label="Line spacing"
                value={settings.lineHeight}
                min={1.2}
                max={2.2}
                step={0.1}
                onChange={(v) => onChange({ lineHeight: Math.round(v * 10) / 10 })}
              />
            </>
          )}

          <Slider
            label="Margins"
            value={settings.margin}
            min={0}
            max={160}
            step={8}
            suffix="px"
            onChange={(v) => onChange({ margin: v })}
          />

          {!pdf && (
            <label className="flex items-center justify-between text-xs text-ink-700">
              <span className="font-medium">Justify text</span>
              <input
                type="checkbox"
                checked={settings.justify}
                onChange={(e) => onChange({ justify: e.target.checked })}
                className="w-4 h-4 accent-ember-500"
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] font-semibold text-ink-400 uppercase tracking-wide">{label}</p>
        <span className="text-xs text-ink-500">{value}{suffix || ''}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-ember-500"
      />
    </div>
  );
}
