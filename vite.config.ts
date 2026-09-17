import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        main: 'index.html',
        notFound: '404.html',
      },
    },
  },
  server: {
    // `npm run dev` serves the pages; `npm run dev:api` runs the API and local database.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        // The API only accepts writes from its own origin.
        headers: { origin: 'http://127.0.0.1:8787' },
      },
    },
  },
});
