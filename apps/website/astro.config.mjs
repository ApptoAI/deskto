// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  server: { host: true },
  vite: { server: { host: true, allowedHosts: true } },
});
