import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { readOwner, readToken } from './core/owner.ts'

const project = path.resolve(process.env.NODIT_PROJECT ?? 'examples/demo')
const serverPort = Number(process.env.NODIT_PORT ?? 4319)

/** Dev only: inject the running CLI server's write token, verified against its owner/session. */
function noditDevToken(): Plugin {
  return {
    name: 'nodit-dev-token',
    apply: 'serve',
    async transformIndexHtml(html) {
      const owner = await readOwner(project)
      const token = owner && (await readToken(project, owner))
      return token ? html.replace('</head>', `<meta name="nodit-token" content="${token}" />\n</head>`) : html
    },
  }
}

export default defineConfig({
  plugins: [react(), noditDevToken()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${serverPort}`, changeOrigin: true } },
  },
})
