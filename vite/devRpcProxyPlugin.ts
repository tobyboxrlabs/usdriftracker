import type { Connect, Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** Mirror api/rpc.ts whitelist so local `vite` matches production proxy behavior. */
const ALLOWED_RPC_ENDPOINTS: readonly string[] = [
  'https://public-node.rsk.co',
  'https://rsk.publicnode.com',
  'https://public-node.testnet.rsk.co',
]

function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function proxyRpcPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? ''
  const { searchParams } = new URL(url, 'http://127.0.0.1')
  const target = searchParams.get('target')
  const rpcEndpoint = target && ALLOWED_RPC_ENDPOINTS.includes(target) ? target : null

  if (!rpcEndpoint) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        error: 'Invalid endpoint',
        message: 'Invalid or missing RPC endpoint. Use ?target=<endpoint>',
        allowedEndpoints: [...ALLOWED_RPC_ENDPOINTS],
      })
    )
    return
  }

  const bodyBuf = await readRequestBody(req)
  const rpcResponse = await fetch(rpcEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyBuf.byteLength ? bodyBuf : undefined,
  })
  const outText = await rpcResponse.text()
  res.statusCode = rpcResponse.status
  res.setHeader('Content-Type', 'application/json')
  res.end(outText)
}

function attachDevRpcProxy(middlewares: Connect.Server) {
  middlewares.use((req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/rpc')) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 200
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Method not allowed' }))
      return
    }

    void proxyRpcPost(req, res).catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Internal Server Error', message: 'RPC proxy failed' }))
      }
    })
  })
}

/**
 * Same-origin `/api/rpc` for local Vite so the browser never calls RSK nodes directly (CORS).
 * Registered for **`vite dev`** and **`vite preview`** (`configurePreviewServer`).
 */
export function devRpcProxyPlugin(): Plugin {
  return {
    name: 'dev-rpc-proxy',
    enforce: 'pre',
    configureServer(server) {
      attachDevRpcProxy(server.middlewares)
    },
    configurePreviewServer(server) {
      attachDevRpcProxy(server.middlewares)
    },
  }
}
