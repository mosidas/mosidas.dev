import { defineConfig } from 'astro/config';

export default defineConfig({
  // CSP の style-src 'self' でインラインの style を禁じるため、CSS を必ず外部ファイルに出す
  build: { inlineStylesheets: 'never' },
});
