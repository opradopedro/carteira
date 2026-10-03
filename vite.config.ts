import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// No GitHub Pages o site fica em https://<usuário>.github.io/<repositório>/
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.BASE_PATH ?? (repo ? `/${repo}/` : '/');

// Versão exibida em Ajustes: commit publicado (no GitHub) e data do build.
const versao = `${(process.env.GITHUB_SHA || 'local').slice(0, 7)} · ${new Date().toISOString().slice(0, 10)}`;

export default defineConfig({
  base,
  define: { __VERSAO__: JSON.stringify(versao) },
  build: { target: 'es2022' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/icon-192.png'],
      manifest: {
        name: 'Minha Carteira',
        short_name: 'Carteira',
        description: 'Acompanhamento de investimentos pessoais. Seus dados ficam só no aparelho.',
        lang: 'pt-BR',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#EEF0F5',
        theme_color: '#3A3FB5',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // O app em si fica em cache para abrir offline; os dados públicos de cotação
        // vêm da rede quando há internet e do cache quando não há.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/data/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'dados-publicos', networkTimeoutSeconds: 8, expiration: { maxEntries: 300 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
