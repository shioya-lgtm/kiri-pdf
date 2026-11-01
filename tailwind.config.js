/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['index.html'],
  theme: {
    extend: {
      // index.html で使っている Tailwind v4 由来のユーティリティを v3 で再現
      spacing: { '0.2': '0.05rem', '4.5': '1.125rem', '13': '3.25rem' },
      borderWidth: { '3': '3px' },
      boxShadow: {
        '2xs': '0 1px rgb(0 0 0 / 0.05)',
        'xs': '0 1px 2px 0 rgb(0 0 0 / 0.05)'
      },
      backdropBlur: { xs: '4px' }
    }
  }
};
