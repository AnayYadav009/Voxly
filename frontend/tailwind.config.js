/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", 'Inter', 'system-ui', 'sans-serif'],
        body:    ["'Inter'", 'system-ui', 'sans-serif'],
      },
      colors: {
        vx: {
          bg:      'var(--bg)',
          card:    'var(--bg-card)',
          surface: 'var(--bg-surface)',
          accent:  'var(--accent)',
          text1:   'var(--text-1)',
          text2:   'var(--text-2)',
          text3:   'var(--text-3)',
          border:  'var(--border)',
          danger:  'var(--danger)',
          warning: 'var(--warning)',
          success: 'var(--success)',
        },
      },
    },
  },
  plugins: [],
};
