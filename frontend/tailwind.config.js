/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          500: '#1d6fd6',
          600: '#1559b3',
          700: '#11478f',
          800: '#0e3a73',
          900: '#0b2f5c',
        },
      },
      keyframes: {
        windowGlow: {
          '0%, 100%': { opacity: '0.65' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'window-glow': 'windowGlow 4s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};