import { defineConfig, loadEnv } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// Anything with these prefixes is baked into the public bundle. NEXT_PUBLIC_* are the public Supabase
// settings the Vercel integration adds; secrets (OPENAI_API_KEY) must never use these prefixes.
const PUBLIC_PREFIXES = ['VITE_', 'NEXT_PUBLIC_'];

/** Fails the build if a secret was given a public prefix by mistake. */
function guardSecrets(env: Record<string, string>) {
  const leaked = Object.keys(env).filter(k => PUBLIC_PREFIXES.some(p => k.startsWith(p)) && /OPENAI|SECRET|SERVICE_ROLE|PRIVATE/i.test(k));
  if (leaked.length) throw new Error(`Refusing to build: ${leaked.join(', ')} would be published in the app bundle. Drop the VITE_/NEXT_PUBLIC_ prefix.`);
}

/** Serves /api/*.ts in `vite dev` the way Vercel does in production (exported POST handler). */
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.match(/^\/api\/([a-z-]+)(?:\?|$)/)?.[1];
        if (!name) return next();
        const mod = await server.ssrLoadModule(`/api/${name}.ts`).catch(() => null);
        if (!mod) {
          res.statusCode = 404;
          return res.end();
        }
        try {
          const handler = mod[req.method ?? 'GET'];
          if (!handler) {
            res.statusCode = 405;
            return res.end();
          }
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
          const out: Response = await handler(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
          res.statusCode = out.status;
          out.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await out.arrayBuffer()));
        } catch (e) {
          server.config.logger.error(`[dev-api] ${(e as Error).message}`);
          res.statusCode = 500;
          res.end();
        }
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  // Server-side variables (OPENAI_API_KEY in .env.local) for the dev /api handlers only.
  const env = loadEnv(mode, process.cwd(), '');
  guardSecrets({ ...env, ...(process.env as Record<string, string>) });
  for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

  return {
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    envPrefix: PUBLIC_PREFIXES,
    plugins: [
      react(),
      devApi(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Calorie tracker',
          short_name: 'Calories',
          description: 'Log meals with a photo and a short note.',
          theme_color: '#FAF3EE',
          background_color: '#FAF3EE',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallbackDenylist: [/^\/auth/, /^\/api\//]
        }
      })
    ]
  };
});
