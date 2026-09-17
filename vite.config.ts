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
});
