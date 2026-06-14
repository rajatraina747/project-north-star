/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm Library palette (CSS-variable driven for light/dark theming) ---
        // Static cream for text/icons that sit on accent or dark surfaces in
        // BOTH themes (does not flip).
        cream: '#fdf9f2',
        // Parchment: surface ramp (50 = base background, higher = raised)
        parchment: {
          50: 'rgb(var(--p-50) / <alpha-value>)',
          100: 'rgb(var(--p-100) / <alpha-value>)',
          200: 'rgb(var(--p-200) / <alpha-value>)',
          300: 'rgb(var(--p-300) / <alpha-value>)',
          400: 'rgb(var(--p-400) / <alpha-value>)',
          500: 'rgb(var(--p-500) / <alpha-value>)',
        },
        // Ink: content ramp (900 = primary text, lower = muted)
        ink: {
          300: 'rgb(var(--i-300) / <alpha-value>)',
          400: 'rgb(var(--i-400) / <alpha-value>)',
          500: 'rgb(var(--i-500) / <alpha-value>)',
          600: 'rgb(var(--i-600) / <alpha-value>)',
          700: 'rgb(var(--i-700) / <alpha-value>)',
          800: 'rgb(var(--i-800) / <alpha-value>)',
          900: 'rgb(var(--i-900) / <alpha-value>)',
        },
        // Ember: terracotta/amber accent
        ember: {
          50: 'rgb(var(--e-50) / <alpha-value>)',
          100: 'rgb(var(--e-100) / <alpha-value>)',
          200: 'rgb(var(--e-200) / <alpha-value>)',
          300: 'rgb(var(--e-300) / <alpha-value>)',
          400: 'rgb(var(--e-400) / <alpha-value>)',
          500: 'rgb(var(--e-500) / <alpha-value>)',
          600: 'rgb(var(--e-600) / <alpha-value>)',
          700: 'rgb(var(--e-700) / <alpha-value>)',
          800: 'rgb(var(--e-800) / <alpha-value>)',
          900: 'rgb(var(--e-900) / <alpha-value>)',
        },
        // North Star Visual Identity Colors
        polaris: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#b9ddfe',
          300: '#7cc4fd',
          400: '#36a7fa',
          500: '#0c8ce9',
          600: '#006ec7',  // Primary Polaris Blue
          700: '#0059a1',
          800: '#064b85',
          900: '#0b3f6e',
        },
        starlight: {
          50: '#fefce8',
          100: '#fef9c3',
          200: '#fef08a',
          300: '#fde047',
          400: '#facc15',
          500: '#eab308',
          600: '#ca8a04',  // Antique Gold
          700: '#a16207',
          800: '#854d0e',
          900: '#713f12',
        },
        obsidian: {
          50: '#fafafa',
          100: '#f4f4f5',
          200: '#e4e4e7',
          300: '#d4d4d8',
          400: '#a1a1aa',
          500: '#71717a',
          600: '#52525b',
          700: '#3f3f46',
          800: '#27272a',
          900: '#18181b',  // Primary dark backgrounds
          950: '#09090b',  // Obsidian Black
        },
      },
      fontFamily: {
        // Warmer, bookish serif for display/headings
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'Cambria', 'serif'],
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'sans-serif'],
      },
      boxShadow: {
        // Warm, soft elevation (brown-tinted rather than pure black)
        'warm': '0 4px 20px -4px rgba(83, 58, 35, 0.18)',
        'warm-lg': '0 18px 50px -12px rgba(83, 58, 35, 0.28)',
      },
      transitionDuration: {
        '250': '250ms',
        '350': '350ms',
      },
      transitionTimingFunction: {
        'soft': 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
