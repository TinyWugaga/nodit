import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { readOwner, readToken } from './core/owner.ts'
import { DEV_CSP } from './server/csp.ts'

const project = path.resolve(process.env.NODIT_PROJECT ?? 'examples/demo')
const serverPort = Number(process.env.NODIT_PORT ?? 4319)

/** The server may have switched projects since Vite started, so ask it which root is open now. */
async function openProject() {
  try {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/health`, { signal: AbortSignal.timeout(1500) })
    const health = (await res.json()) as { root?: string; ownerId?: string; sessionId?: string }
    if (!health.root) return null
    const owner = await readOwner(health.root)
    return owner && owner.ownerId === health.ownerId && owner.sessionId === health.sessionId ? { root: health.root, owner } : null
  } catch {
    const owner = await readOwner(project)
    return owner && { root: project, owner }
  }
}

/** Dev only: inject the running CLI server's write token, verified against its owner/session. */
function noditDevToken(): Plugin {
  return {
    name: 'nodit-dev-token',
    apply: 'serve',
    async transformIndexHtml(html) {
      const open = await openProject()
      const token = open && (await readToken(open.root, open.owner))
      return token ? html.replace('</head>', `<meta name="nodit-token" content="${token}" />\n</head>`) : html
    },
  }
}

export default defineConfig({
  plugins: [react(), noditDevToken()],
  server: {
    port: 5173,
    strictPort: true,
    headers: { 'Content-Security-Policy': DEV_CSP },
    proxy: { '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true } },
  },
})
