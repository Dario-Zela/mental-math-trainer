import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Served from https://dario-zela.github.io/mental-math-trainer/ — hash routing,
// so no rewrite rules are needed anywhere.
export default defineConfig({
  base: '/mental-math-trainer/',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
