import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-ignore — plain-JS backend cores shared with the Netlify functions (no types)
import { getStatements } from './netlify/lib/statementsCore.mjs'
// @ts-ignore — plain-JS backend core (no types)
import { getSecurityProfiles } from './netlify/lib/securityCore.mjs'
// @ts-ignore — plain-JS backend core (no types)
import { getGold } from './netlify/lib/goldCore.mjs'

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
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), backendApiDev()],
})
