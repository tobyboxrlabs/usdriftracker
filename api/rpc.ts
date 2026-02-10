import type { VercelRequest, VercelResponse } from '@vercel/node'
import { setCorsHeaders, setSecurityHeaders } from './security.js'

// Expected client version (git commit hash from build)
// This should match VITE_GIT_COMMIT_HASH from the frontend build
// Set via environment variable at build time, or use 'unknown' as fallback
const EXPECTED_CLIENT_VERSION = process.env.VITE_GIT_COMMIT_HASH || process.env.GIT_COMMIT_HASH || 'unknown'

// Allowed RPC endpoints (whitelist for security)
const ALLOWED_RPC_ENDPOINTS = [
  'https://public-node.rsk.co',
  'https://rsk.publicnode.com',
]

// ============================================================================
// RPC Response Caching
// ============================================================================

interface CachedResponse {
  result: any
  timestamp: number
}

// Cache eth_chainId forever (module scope, persists across requests in same process)
const chainIdCache = new Map<string, CachedResponse>()

// Cache block number and network metadata for 30 seconds per provider
const metadataCache = new Map<string, CachedResponse>()
const METADATA_CACHE_TTL = 30000 // 30 seconds

// Methods that should be cached forever
const FOREVER_CACHE_METHODS = ['eth_chainId']

// Methods that should be cached for short duration
const SHORT_CACHE_METHODS = ['eth_blockNumber', 'net_version']

/**
 * Generate cache key from endpoint, method, and params
 */
function getCacheKey(endpoint: string, method: string, params?: any[]): string {
  const paramsKey = params ? JSON.stringify(params) : ''
  return `${endpoint}:${method}:${paramsKey}`
}

/**
 * Check if cached response is still valid
 */
function isCacheValid(cached: CachedResponse, ttl: number): boolean {
  return Date.now() - cached.timestamp < ttl
}

/**
 * Get cached response if available and valid
 */
function getCachedResponse(
  endpoint: string,
  method: string,
  params?: any[]
): any | null {
  const cacheKey = getCacheKey(endpoint, method, params)
  
  if (FOREVER_CACHE_METHODS.includes(method)) {
    const cached = chainIdCache.get(cacheKey)
    if (cached) {
      console.log(`[rpc] Cache HIT (forever): ${method}`)
      return cached.result
    }
  } else if (SHORT_CACHE_METHODS.includes(method)) {
    const cached = metadataCache.get(cacheKey)
    if (cached && isCacheValid(cached, METADATA_CACHE_TTL)) {
      console.log(`[rpc] Cache HIT (${METADATA_CACHE_TTL}ms): ${method}`)
      return cached.result
    }
  }
  
  return null
}

/**
 * Store response in cache
 */
function setCachedResponse(
  endpoint: string,
  method: string,
  params: any[] | undefined,
  result: any
): void {
  const cacheKey = getCacheKey(endpoint, method, params)
  const cached: CachedResponse = {
    result,
    timestamp: Date.now(),
  }
  
  if (FOREVER_CACHE_METHODS.includes(method)) {
    chainIdCache.set(cacheKey, cached)
    console.log(`[rpc] Cache SET (forever): ${method}`)
  } else if (SHORT_CACHE_METHODS.includes(method)) {
    metadataCache.set(cacheKey, cached)
    console.log(`[rpc] Cache SET (${METADATA_CACHE_TTL}ms): ${method}`)
  }
}

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
  // Check client version
  const clientVersion = req.headers['x-client-version'] as string | undefined
  const isOldClient = !clientVersion || clientVersion !== EXPECTED_CLIENT_VERSION
  
  // Log handler invocation immediately
  console.log('[rpc] === Handler Invoked ===')
  console.log('[rpc] Method:', req.method)
  console.log('[rpc] URL:', req.url)
  console.log('[rpc] Query:', req.query)
  console.log('[rpc] Client Version:', clientVersion || '(missing)')
  console.log('[rpc] Expected Version:', EXPECTED_CLIENT_VERSION)
  console.log('[rpc] Is Old Client:', isOldClient)
  
  if (isOldClient) {
    console.warn('[rpc] ⚠️ OLD CLIENT DETECTED ⚠️')
    console.warn('[rpc] Client version:', clientVersion || 'MISSING')
    console.warn('[rpc] Expected version:', EXPECTED_CLIENT_VERSION)
    console.warn('[rpc] This client may be using outdated code from before ESM refactor')
    console.warn('[rpc] User should refresh their browser to get the latest version')
  }
  
  console.log('[rpc] Headers:', {
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    origin: req.headers.origin,
    'x-client-version': clientVersion,
  })
  
  // Top-level error handler to catch any initialization errors
  try {
    // Set security headers
    setSecurityHeaders(res)
    
    // Set CORS headers (restricted to allowed origins)
    setCorsHeaders(req, res)
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      console.log('[rpc] OPTIONS request - returning 200')
      return res.status(200).end()
    }

    if (req.method !== 'POST') {
      console.error('[rpc] === 405 Error: Method Not Allowed ===')
      console.error('[rpc] Method:', req.method)
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: 'Only POST requests are supported',
        receivedMethod: req.method
      })
    }

    try {
      // Get target RPC endpoint from query param (target is in query string, not body)
      const target = req.query.target as string
      
      // Log query params for debugging
      console.log('[rpc] Query params:', JSON.stringify(req.query))
      console.log('[rpc] Target from query:', target)
      
      const rpcEndpoint = getRpcEndpoint(target)
      
      if (!rpcEndpoint) {
        console.error('[rpc] === 400 Error: Invalid Endpoint ===')
        console.error('[rpc] Provided target:', target)
        console.error('[rpc] Allowed endpoints:', ALLOWED_RPC_ENDPOINTS)
        console.error('[rpc] Query params:', req.query)
        return res.status(400).json({ 
          error: 'Invalid endpoint',
          message: 'Invalid or missing RPC endpoint. Use ?target=<endpoint>',
          providedTarget: target || '(missing)',
          allowedEndpoints: ALLOWED_RPC_ENDPOINTS
        })
      }

      // Get JSON-RPC request from body
      // Vercel should parse JSON automatically, but handle both parsed and raw cases
      let rpcRequest = req.body
      
      // Log body info for debugging
      console.log('[rpc] Body type:', typeof rpcRequest)
      console.log('[rpc] Body value:', rpcRequest ? JSON.stringify(rpcRequest).substring(0, 200) : '(empty)')
      
      // If body is undefined or a string, try to parse it
      if (!rpcRequest || typeof rpcRequest === 'string') {
        try {
          const bodyText = typeof rpcRequest === 'string' ? rpcRequest : (req as any).rawBody || ''
          rpcRequest = bodyText ? JSON.parse(bodyText) : null
        } catch (parseError) {
          console.error('[rpc] === 400 Error: JSON Parse Failed ===')
          console.error('[rpc] Parse error:', parseError)
          console.error('[rpc] Body text:', typeof rpcRequest === 'string' ? rpcRequest.substring(0, 200) : 'N/A')
          return res.status(400).json({ 
            error: 'Invalid request',
            message: 'Request body must be valid JSON',
            parseError: parseError instanceof Error ? parseError.message : String(parseError)
          })
        }
      }
      
      if (!rpcRequest || typeof rpcRequest !== 'object') {
        console.error('[rpc] === 400 Error: Invalid Body Type ===')
        console.error('[rpc] Body type:', typeof rpcRequest)
        console.error('[rpc] Body value:', rpcRequest)
        return res.status(400).json({ 
          error: 'Invalid request',
          message: 'Request body must be a valid JSON-RPC request',
          bodyType: typeof rpcRequest,
          bodyValue: rpcRequest
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

      // Check cache first for cacheable methods
      const paramsArray = Array.isArray(rpcRequest.params) ? rpcRequest.params : undefined
      const cachedResult = getCachedResponse(rpcEndpoint, rpcMethod, paramsArray)
      
      if (cachedResult !== null) {
        // Return cached response
        return res.status(200).json({
          jsonrpc: '2.0',
          id: rpcRequest.id,
          result: cachedResult,
        })
      }

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

      // Cache successful responses for cacheable methods
      if (!rpcData.error && rpcData.result !== undefined) {
        setCachedResponse(rpcEndpoint, rpcMethod, paramsArray, rpcData.result)
      }

      // Return the RPC response
      return res.status(200).json(rpcData)

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

