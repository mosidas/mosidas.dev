import { defineConfig } from 'astro/config';

export default defineConfig({
  // CSP の style-src 'self' でインラインの style を禁じるため、CSS を必ず外部ファイルに出す
  build: { inlineStylesheets: 'never' },
  // CSP の script-src でインラインの script を禁じるため、Astro の script を必ず外部ファイルに出す
  vite: { build: { assetsInlineLimit: 0 } },
});
