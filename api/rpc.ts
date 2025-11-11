import type { VercelRequest, VercelResponse } from '@vercel/node'
import { 
  logError, 
  logWarning, 
  logInfo, 
  createErrorResponse, 
  generateRequestId,
  type ErrorLogContext 
} from './errorLogger'

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
    const requestId = generateRequestId()
    
    const context: ErrorLogContext = {
      endpoint: '/api/rpc',
      method: req.method || 'UNKNOWN',
      userAgent: req.headers['user-agent'],
      ip: req.headers['x-forwarded-for']?.toString().split(',')[0] || req.headers['x-real-ip']?.toString() || 'unknown',
    }
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('X-Request-ID', requestId)

    if (req.method === 'OPTIONS') {
      return res.status(200).end()
    }

    if (req.method !== 'POST') {
      logWarning('Method not allowed', context, requestId)
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: 'Only POST requests are supported',
        requestId 
      })
    }

    try {
      // Get target RPC endpoint from query param (target is in query string, not body)
      const target = req.query.target as string
      const rpcEndpoint = getRpcEndpoint(target)
      
      if (!rpcEndpoint) {
        logWarning('Invalid or missing RPC endpoint', context, requestId)
        return res.status(400).json({ 
          error: 'Invalid endpoint',
          message: 'Invalid or missing RPC endpoint. Use ?target=<endpoint>',
          allowedEndpoints: ALLOWED_RPC_ENDPOINTS,
          requestId 
        })
      }

      // Get JSON-RPC request from body
      // Vercel should parse JSON automatically, but handle both parsed and raw cases
      let rpcRequest = req.body
      
      // If body is a string, parse it
      if (typeof rpcRequest === 'string') {
        try {
          rpcRequest = JSON.parse(rpcRequest)
        } catch (parseError) {
          logWarning('Failed to parse request body', context, requestId)
          return res.status(400).json({ 
            error: 'Invalid request',
            message: 'Request body must be valid JSON',
            requestId 
          })
        }
      }
      
      if (!rpcRequest || typeof rpcRequest !== 'object') {
        logWarning('Invalid RPC request body', context, requestId)
        return res.status(400).json({ 
          error: 'Invalid request',
          message: 'Request body must be a valid JSON-RPC request',
          requestId 
        })
      }

      logInfo('Proxying RPC request', context, requestId, { 
        endpoint: rpcEndpoint,
        method: rpcRequest.method 
      })

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
        logError(
          new Error(`RPC endpoint returned ${rpcResponse.status}`),
          { ...context, status: rpcResponse.status, responsePreview: errorText.substring(0, 100) },
          requestId
        )
        
        return res.status(rpcResponse.status).json({ 
          error: 'RPC error',
          message: 'Failed to fetch from RPC endpoint',
          requestId
        })
      }

      const rpcData = await rpcResponse.json()
      
      logInfo('RPC request successful', context, requestId, { 
        endpoint: rpcEndpoint,
        hasError: !!rpcData.error 
      })

      // Return the RPC response
      return res.status(200).json(rpcData)
    } catch (error) {
      logError(error, { ...context, operation: 'proxyRpc' }, requestId)
      
      const errorResponse = createErrorResponse(
        error,
        requestId,
        'Failed to proxy RPC request. Please try again later.'
      )
      
      return res.status(500).json(errorResponse)
    }
  } catch (topLevelError) {
    // Catch any errors that occur before we can set up proper error handling
    console.error('[rpc] Top-level error:', topLevelError)
    const errorMessage = topLevelError instanceof Error ? topLevelError.message : String(topLevelError)
    const errorStack = topLevelError instanceof Error ? topLevelError.stack : undefined
    
    // Try to set headers even on error
    try {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Type', 'application/json')
    } catch {}
    
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      requestId: `error_${Date.now()}`,
      ...(process.env.NODE_ENV === 'development' && { details: errorMessage, stack: errorStack })
    })
  }
}

