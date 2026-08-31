// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  server: { host: true, allowedHosts: ['.exe.xyz'] },
});
