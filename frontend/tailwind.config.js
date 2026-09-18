/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
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
    },
  },
  plugins: [require('tailwindcss-animate')],
};