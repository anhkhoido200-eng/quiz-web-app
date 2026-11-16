/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './admin.html',
    './app.js',
    './admin.js',
    './arena.js'
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Be Vietnam Pro"', '"Plus Jakarta Sans"', 'sans-serif'],
        heading: ['"Be Vietnam Pro"', '"Outfit"', 'sans-serif']
      },
      colors: {
        brand: {
          50: '#f0f7ff',
          100: '#e0effe',
          400: '#38bdf8',
          500: '#0284c7',
          600: '#1d4ed8',
          700: '#1e3a8a',
          800: '#172554',
          900: '#0b192c'
        },
        cream: {
          50: '#fbf8f3',
          100: '#f5ede0',
          200: '#eadbc4',
          300: '#d6c3a5'
        }
      }
    }
  },
  plugins: []
};
