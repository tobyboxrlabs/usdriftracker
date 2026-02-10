import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCorsHeaders, setSecurityHeaders } from './security.js'

// Allowed RPC endpoints (whitelist for security)
const ALLOWED_RPC_ENDPOINTS = [
  'https://public-node.rsk.co',
  'https://rsk.publicnode.com',
  'https://rpc.ankr.com/rsk',
]

// Get the RPC endpoint from query param or use default
function getRpcEndpoint(target?: string): string | null {
  if (!target) {
    return ALLOWED_RPC_ENDPOINTS[0] // Default to first allowed endpoint
  }
  
  // Validate that the target is in the whitelist
  if (ALLOWED_RPC_ENDPOINTS.includes(target)) {
    return target
  }
  
  return null
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // Top-level error handler to catch any initialization errors
  try {
    // Set security headers
    setSecurityHeaders(res)
    
    // Set CORS headers (restricted to allowed origins)
    setCorsHeaders(req, res)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      return res.status(200).end()
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: 'Only POST requests are supported'
      })
    }

    try {
      // Get target RPC endpoint from query param (target is in query string, not body)
      const target = req.query.target as string
      const rpcEndpoint = getRpcEndpoint(target)
      
      if (!rpcEndpoint) {
        return res.status(400).json({ 
          error: 'Invalid endpoint',
          message: 'Invalid or missing RPC endpoint. Use ?target=<endpoint>',
          allowedEndpoints: ALLOWED_RPC_ENDPOINTS
        })
      }

      // Get JSON-RPC request from body
      // Vercel should parse JSON automatically, but handle both parsed and raw cases
      let rpcRequest = req.body
      
      // If body is undefined or a string, try to parse it
      if (!rpcRequest || typeof rpcRequest === 'string') {
        try {
          const bodyText = typeof rpcRequest === 'string' ? rpcRequest : (req as any).rawBody || ''
          rpcRequest = bodyText ? JSON.parse(bodyText) : null
        } catch (parseError) {
          console.error('[rpc] Failed to parse body:', parseError)
          return res.status(400).json({ 
            error: 'Invalid request',
            message: 'Request body must be valid JSON'
          })
        }
      }
      
      if (!rpcRequest || typeof rpcRequest !== 'object') {
        console.error('[rpc] Invalid body type:', typeof rpcRequest)
        return res.status(400).json({ 
          error: 'Invalid request',
          message: 'Request body must be a valid JSON-RPC request'
        })
      }

      const requestOrigin = req.headers.origin || 'no-origin'
      const userAgent = req.headers['user-agent'] || 'no-user-agent'
      const rpcMethod = rpcRequest.method || 'unknown'
      const rpcParams = Array.isArray(rpcRequest.params) 
        ? `[${rpcRequest.params.length} params]` 
        : rpcRequest.params 
          ? JSON.stringify(rpcRequest.params).substring(0, 100) 
          : 'no params'
      const requestId = rpcRequest.id || 'no-id'

      // Detailed logging for investigation
      console.log('[rpc] === RPC Request Details ===')
      console.log('[rpc] Endpoint:', rpcEndpoint)
      console.log('[rpc] Method:', rpcMethod)
      console.log('[rpc] Params:', rpcParams)
      console.log('[rpc] Request ID:', requestId)
      console.log('[rpc] Origin:', requestOrigin)
      console.log('[rpc] User-Agent:', userAgent?.substring(0, 100))
      console.log('[rpc] Timestamp:', new Date().toISOString())

      // Forward the request to the RPC endpoint
      const rpcResponse = await fetch(rpcEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rpcRequest),
      })

      if (!rpcResponse.ok) {
        const errorText = await rpcResponse.text()
        console.error('[rpc] === RPC Error Details ===')
        console.error('[rpc] Endpoint:', rpcEndpoint)
        console.error('[rpc] Method:', rpcMethod)
        console.error('[rpc] HTTP Status:', rpcResponse.status)
        console.error('[rpc] HTTP Status Text:', rpcResponse.statusText)
        console.error('[rpc] Error Response:', errorText)
        console.error('[rpc] Request ID:', requestId)
        console.error('[rpc] Origin:', requestOrigin)
        console.error('[rpc] Timestamp:', new Date().toISOString())
        
        return res.status(rpcResponse.status).json({ 
          error: 'RPC error',
          message: 'Failed to fetch from RPC endpoint',
          endpoint: rpcEndpoint,
          method: rpcMethod,
          status: rpcResponse.status,
          ...(process.env.NODE_ENV === 'development' && { details: errorText.substring(0, 500) })
        })
      }

      const rpcData = await rpcResponse.json()
      console.log('[rpc] Request successful - Method:', rpcMethod, 'Endpoint:', rpcEndpoint, 'HasError:', !!rpcData.error)

    } catch (error) {
      console.error('[rpc] Error proxying request:', error)
      
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to proxy RPC request'
      })
    }
  } catch (topLevelError) {
    // Catch any errors that occur before we can set up proper error handling
    console.error('[rpc] Top-level error:', topLevelError)
    const errorMessage = topLevelError instanceof Error ? topLevelError.message : String(topLevelError)
    
    // Try to set headers even on error
    try {
      setCorsHeaders(req, res)
      setSecurityHeaders(res)
      res.setHeader('Content-Type', 'application/json')
    } catch {}
    
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      ...(process.env.NODE_ENV === 'development' && { details: errorMessage })
    })
  }
}

