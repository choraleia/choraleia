import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/postcss'
import fs from 'node:fs'
import path from 'node:path'

const monacoAssetsPlugin = () => {
  const monacoSource = path.resolve(process.cwd(), 'node_modules/monaco-editor/min/vs')
  const servePrefix = '/monaco/vs/'

  const copyDir = (src: string, dest: string) => {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name)
      const destPath = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        copyDir(srcPath, destPath)
      } else {
        fs.copyFileSync(srcPath, destPath)
      }
    }
  }

  let resolvedOutDir = ''
  let resolvedRoot = ''

  return {
    name: 'monaco-local-assets',
    configResolved(config) {
      resolvedOutDir = path.resolve(config.root, config.build.outDir)
      resolvedRoot = config.root
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(servePrefix)) return next()
        const relativePath = req.url.substring(servePrefix.length)
        const filePath = path.join(monacoSource, relativePath)
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.statusCode = 404
            res.end('Not found')
            return
          }
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          res.end(data)
        })
      })
    },
    writeBundle() {
      const destination = path.join(resolvedOutDir, 'monaco/vs')
      copyDir(monacoSource, destination)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig(() => {
  // Dev-only: send API and websocket traffic to the Go backend.
  // You can override it with:
  //   VITE_BACKEND_TARGET=http://127.0.0.1:8088
  // or reuse:
  //   VITE_API_BASE_URL=http://127.0.0.1:8088
  //
  // Wails dev mode may provide its own backend URL via environment.
  const backendTarget =
    process.env.WAILS_BACKEND_URL ||
    process.env.VITE_BACKEND_TARGET ||
    process.env.VITE_API_BASE_URL ||
    'http://127.0.0.1:8088'

  return {
    plugins: [react(), monacoAssetsPlugin()],
    css: {
      postcss: {
        plugins: [
          tailwindcss()
        ]
      }
    },
    server: {
      // Port may be overridden by Wails via CLI args: `vite --port ...`
      port: 3000,
      host: true,
      proxy: {
        // Task events WebSocket (must be before /api).
        '/api/tasks/ws': {
          target: backendTarget,
          ws: true,
          changeOrigin: true,
        },

        // Event notification WebSocket (must be before /api).
        '/api/events/ws': {
          target: backendTarget,
          ws: true,
          changeOrigin: true,
        },

        // REST API
        '/api': {
          target: backendTarget,
          changeOrigin: true
        },
        // Websocket endpoints
        // Vite expects an http(s) target here; `ws: true` enables websocket proxying.
        '/terminal': {
          target: backendTarget,
          ws: true,
          changeOrigin: true
        }
      }
    }
  }
})
