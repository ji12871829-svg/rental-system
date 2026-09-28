/** @type {import('tailwindcss').Config} */
// Design system: Amie — see design/amie-DESIGN.md.
// One achromatic canvas (white/fog), ash hairlines, and a single electric
// sky-blue (#11a8ff) reserved for action. Numeric ramps (brand/sky) are
// validated by scripts/check-tailwind-tokens.mjs; single-value keys (fog,
// ash, divider, graphite, silver, ink, charcoal, pale, pink, mint, violet,
// sun) are literal tokens from the DESIGN.md.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ebf9ff',
          100: '#d6f2ff',
          200: '#b0e6ff',
          300: '#7ad4ff',
          400: '#40beff',
          500: '#11a8ff',
          600: '#0b8ede',
          700: '#0c73b8',
          800: '#105e93',
          900: '#134e76',
        },
        sky: {
          50: '#ebf9ff',
          100: '#d6f2ff',
          200: '#b0e6ff',
          300: '#7ad4ff',
          400: '#40beff',
          500: '#11a8ff',
          600: '#0b8ede',
          700: '#0c73b8',
          800: '#105e93',
          900: '#134e76',
        },
        fog: '#fafafa',
        ash: '#cdcdcd',
        divider: '#ebebeb',
        graphite: '#5c5c5c',
        silver: '#a0a0a0',
        ink: '#000000',
        charcoal: '#2e2e2e',
        pale: '#cfeeff',
        pink: '#f6a6a6',
        mint: '#01ca45',
        violet: '#a050ff',
        sun: '#fbefaf',
      },
      fontFamily: {
        sans: ['Inter', 'Inter var', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        serif: ['Georgia', 'Cambria', 'Times New Roman', 'Times', 'serif'],
        mono: ['IBM Plex Mono', 'JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        // Amie elevates with shadow-as-border: a hairline ring plus feathered
        // layers instead of visible strokes (design/amie-DESIGN.md — Shadows).
        sm: 'rgba(0, 0, 0, 0.05) 0px 0px 0px 1px inset',
        DEFAULT:
          'rgba(0, 0, 0, 0.06) 0px 0px 0px 1px, rgba(0, 0, 0, 0.06) 0px 1px 1px -0.5px, rgba(0, 0, 0, 0.06) 0px 3px 3px -1.5px',
        md: 'rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgba(0, 0, 0, 0.1) 0px 1px 2px -1px',
        lg: 'rgba(0, 0, 0, 0.12) 0px 4px 14px 0px, rgba(0, 0, 0, 0.1) 0px 2px 4px -1px',
        xl: 'rgba(0, 0, 0, 0.06) 0px 0px 0px 1px, rgba(0, 0, 0, 0.16) 0px 18px 40px -12px',
        '2xl': 'rgba(0, 0, 0, 0.06) 0px 0px 0px 1px, rgba(0, 0, 0, 0.22) 0px 24px 56px -16px',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
