// Usado só para regenerar o tailwind.css se você adicionar classes novas no HTML/JS:
//   npx tailwindcss@3 -c tailwind.config.js -o tailwind.css --minify
module.exports = {
  content: ['./index.html', './app.js'],
  theme: { extend: {} },
  plugins: []
};
