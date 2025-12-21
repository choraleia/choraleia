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
  const backendTarget =
    process.env.VITE_BACKEND_TARGET ||
    process.env.VITE_API_BASE_URL ||
    'http://127.0.0.1:8088'

  const backendWsTarget = backendTarget.replace(/^http/, 'ws')

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
      port: 3000,
      host: true,
      proxy: {
        // REST API
        '/api': {
          target: backendTarget,
          changeOrigin: true
        },
        // Websocket endpoints
        '/terminal': {
          target: backendWsTarget,
          ws: true,
          changeOrigin: true
        }
      }
    }
  }
})
