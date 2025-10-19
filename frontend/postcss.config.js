// postcss.config.js
export default {
  plugins: {
    "@tailwindcss/postcss": {}, // <-- use this, NOT "tailwindcss"
    autoprefixer: {},
  },
};
