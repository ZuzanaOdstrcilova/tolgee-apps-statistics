import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Ports are env-overridable so multiple plugins can run side-by-side.
// Defaults match the historical 5180/5181 pair.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const vitePort = Number(env.VITE_PORT ?? 5180)
  const serverPort = Number(env.SERVER_PORT ?? 5181)
  const serverTarget = `http://localhost:${serverPort}`
  return {
    plugins: [react()],
    server: {
      port: vitePort,
      strictPort: true,
      // Vite 6+ restricts dev-server CORS by default, which makes it answer
      // the CORS preflight for proxied endpoints (/decorators, /api/*) WITHOUT
      // an Access-Control-Allow-Origin — so the Tolgee webapp's cross-origin
      // calls get blocked. Reflect the request origin so preflights pass; the
      // Express server still sets its own `*` on the actual responses.
      cors: true,
      // Cloudflare quick tunnels expose a single port. Vite is the
      // tunnel target; these proxies forward Tolgee → Express endpoints
      // through the one public hostname.
      proxy: {
        '/manifest.json': serverTarget,
        '/webhook': serverTarget,
        '/decorators': serverTarget,
        '/api': serverTarget,
      },
      // Quick tunnels rewrite the Host header to the trycloudflare.com
      // hostname; Vite's default host check would reject those requests.
      allowedHosts: true,
    },
  }
})
