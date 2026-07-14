import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore — plain-JS backend cores shared with the Netlify functions (no types)
import { getStatements } from './netlify/lib/statementsCore.mjs'
// @ts-ignore — plain-JS backend core (no types)
import { getSecurityProfiles } from './netlify/lib/securityCore.mjs'
// @ts-ignore — plain-JS backend core (no types)
import { getGold } from './netlify/lib/goldCore.mjs'
// @ts-ignore — plain-JS backend core (no types) — flight monitoring (isolated)
import { getOpenSkyStates } from './netlify/lib/openskyCore.mjs'
// @ts-ignore — plain-JS backend core (no types) — Global Alert Feed, Stage 1 catch-all
import { getGdeltFeed } from './netlify/lib/gdeltFeedCore.mjs'
// @ts-ignore — plain-JS backend core (no types) — Global Alert Feed, Stages 1-6 cards
import { getFeedCards, getFastFeedCards, fullFeedIsReady } from './netlify/lib/feedCardsCore.mjs'
// @ts-ignore — plain-JS backend core (no types) — source-link HTTP validation
import { checkUrl } from './netlify/lib/linkCheckCore.mjs'

// Serves the backend proxy endpoints during `vite dev` so the frontend hits the
// exact same routes locally as in production (Netlify Functions).
function backendApiDev(): Plugin {
  return {
    name: 'backend-api-dev',
    configureServer(server) {
      server.middlewares.use('/api/statements', async (_req, res) => {
        try {
          const payload = await getStatements()
          const allFailed = Object.values(payload.sources).every((s: any) => !s.ok)
          res.statusCode = allFailed && payload.statements.length === 0 ? 502 : 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'proxy-failure', statements: [] }))
        }
      })

      server.middlewares.use('/api/security', async (_req, res) => {
        try {
          const payload = await getSecurityProfiles()
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'security-proxy-failure', profiles: [] }))
        }
      })

      server.middlewares.use('/api/gold', async (_req, res) => {
        try {
          const data = await getGold()
          res.statusCode = data ? 200 : 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(data ?? { error: 'gold-unavailable' }))
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'gold-proxy-failure' }))
        }
      })

      // The adapters call fetch('/api/…'), which has no origin server-side, so
      // fetch is shimmed once onto this dev server.
      const installFetchShim = () => {
        const realFetch = globalThis.fetch
        if ((globalThis.fetch as any).__feedShim) return
        const port = server.config.server.port ?? 5173
        const origin = `http://localhost:${port}`
        const shim: any = (input: any, init: any) =>
          typeof input === 'string' && input.startsWith('/api/')
            ? realFetch(`${origin}${input}`, init)
            : realFetch(input, init)
        shim.__feedShim = true
        globalThis.fetch = shim
      }

      const loadPipeline = async () => {
        installFetchShim()
        return server.ssrLoadModule('/src/services/feed/pipeline.ts')
      }

      const fullOptions = {
        includeGdelt: true,
        maxSignals: Number(process.env.FEED_MAX_SIGNALS ?? 120),
        summaryLimit: Number(process.env.FEED_SUMMARY_LIMIT ?? 12),
      }

      // FAST TIER — deterministic stages only, ~2s. Registered BEFORE /api/feed
      // because connect matches by prefix and would otherwise swallow this path.
      server.middlewares.use('/api/feed/fast', async (_req, res) => {
        try {
          const mod = await loadPipeline()
          const warmFull = () => getFeedCards(mod.runPipeline, fullOptions)
          const payload = await getFastFeedCards(
            () => mod.runPipelineFast({ maxSignals: fullOptions.maxSignals }),
            warmFull,
          )
          // Tell the client whether the AI-scored run is already available.
          payload.fullReady = fullFeedIsReady()
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        } catch (err) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, provisional: true, cards: [], error: String(err) }))
        }
      })

      // Is the expensive run ready yet? Cheap poll target for the client.
      server.middlewares.use('/api/feed/status', async (_req, res) => {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ fullReady: fullFeedIsReady() }))
      })

      // FULL TIER — Stages 1-6 including every LLM call. Cold ~530s, cached 5min.
      server.middlewares.use('/api/feed', async (_req, res) => {
        try {
          const mod = await loadPipeline()
          const payload = await getFeedCards(mod.runPipeline, fullOptions)
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(payload))
        } catch (err) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, cards: [], error: String(err) }))
        }
      })

      server.middlewares.use('/api/gdelt-feed', async (_req, res) => {
        // Always 200; the payload's `ok` flag carries the real upstream health.
        const payload = await getGdeltFeed()
        res.statusCode = 200
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(payload))
      })

      server.middlewares.use('/api/link-check', async (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')
          if (!url) {
            res.statusCode = 400
            res.setHeader('content-type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, status: 0, error: 'missing url' }))
            return
          }
          const result = await checkUrl(url)
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(result))
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ok: false, status: 0 }))
        }
      })

      server.middlewares.use('/api/opensky', async (_req, res) => {
        try {
          const data = await getOpenSkyStates()
          res.statusCode = 200
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(data))
        } catch {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: 'opensky-proxy-failure', time: 0, states: [] }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite only exposes VITE_-prefixed vars to the browser (import.meta.env). The
  // dev-only backend middleware above runs in Node and reads server-side secrets
  // from process.env (e.g. OPENSKY_CLIENT_ID/SECRET, ACLED_*, RELIEFWEB_APPNAME),
  // exactly like the Netlify Functions do in production. Vite does NOT populate
  // process.env from .env, so load ALL keys (no prefix filter) and merge them in
  // — without overriding anything already set in the real environment.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  return {
    plugins: [react(), backendApiDev()],
  }
})
