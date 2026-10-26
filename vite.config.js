import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { contributionsMiddleware } from './server/contributions.js';

const root = import.meta.dirname;

function githubContributionsApi() {
  return {
    name: 'github-contributions-api',
    configureServer(server) {
      server.middlewares.use('/api/contributions', contributionsMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/contributions', contributionsMiddleware);
    }
  };
}

export default defineConfig({
  plugins: [githubContributionsApi()],
  build: {
    // The shared chunk is almost entirely three.js (~145 kB gzipped).
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      input: {
        index: resolve(root, 'index.html'),
        skyline: resolve(root, 'skyline.html'),
        pulsar: resolve(root, 'pulsar.html')
      }
    }
  }
});
