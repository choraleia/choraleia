import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/postcss'

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
    plugins: [react()],
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
