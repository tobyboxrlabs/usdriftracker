/**
 * Edge Middleware for blocking outdated clients
 * Blocks old client versions at the edge before they reach API endpoints
 * 
 * Protection:
 * - Blocks outdated clients for /api/rpc endpoint (410 Gone)
 * - No Redis dependency - simple version check
 */

/**
 * Get expected client version (git commit hash)
 * Same logic as api/rpc.ts - uses Vercel's commit SHA
 */
function getExpectedClientVersion(): string {
  // Vercel provides VERCEL_GIT_COMMIT_SHA at runtime (same value used in vite.config.ts during build)
  // Take first 7 characters to match the short hash format used by vite.config.ts
  return process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 7) || 
         process.env.VITE_GIT_COMMIT_HASH || 
         process.env.GIT_COMMIT_HASH || 
         'unknown'
}

/**
 * Get client IP from request headers
 * Handles Vercel's proxy headers
 */
function getClientIp(request: Request): string {
  // Check x-forwarded-for header (Vercel sets this)
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, first one is the client
    const ips = forwardedFor.split(',')[0].trim()
    return ips
  }

  // Fallback to x-real-ip
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }

  // Fallback to cf-connecting-ip (Cloudflare)
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) {
    return cfIp.trim()
  }

  // Last resort: unknown
  return 'unknown'
}

/**
 * Vercel Edge Middleware
 * Runs at the edge before requests reach your API endpoints
 * Uses standard Web API Request/Response
 * Returns Response to intercept, or undefined to pass through
 */
export default async function middleware(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url)
  const pathname = url.pathname

  // Only check API endpoints
  if (!pathname.startsWith('/api/')) {
    // Let request pass through
    return undefined
  }

  // Skip health check endpoints
  if (pathname === '/api/health' || pathname === '/api/healthz') {
    return undefined
  }

  // Block old clients for /api/rpc endpoint
  // This prevents outdated clients from consuming resources
  if (pathname.startsWith('/api/rpc')) {
    const clientVersion = request.headers.get('x-client-version')
    const expectedVersion = getExpectedClientVersion()
    
    // Log all /api/rpc requests for debugging
    const clientIp = getClientIp(request)
    console.log(
      `[middleware] Checking /api/rpc request - ` +
      `IP: ${clientIp}, ` +
      `Client Version: ${clientVersion || 'MISSING'}, ` +
      `Expected: ${expectedVersion}, ` +
      `Match: ${clientVersion === expectedVersion ? 'YES' : 'NO'}`
    )
    
    // Block if version is missing or doesn't match
    if (!clientVersion || clientVersion !== expectedVersion) {
      console.warn(
        `[middleware] 🚫 BLOCKING OLD CLIENT 🚫 IP: ${clientIp}, ` +
        `Client Version: ${clientVersion || 'MISSING'}, ` +
        `Expected: ${expectedVersion}, ` +
        `Path: ${pathname}`
      )
      
      // Return 410 Gone - resource no longer available
      // This tells the client (and browsers) that the resource is permanently gone
      return new Response(
        JSON.stringify({
          error: 'Client version outdated',
          message: 'Please refresh your browser to get the latest version. This client version is no longer supported.',
          code: 'OUTDATED_CLIENT',
          clientVersion: clientVersion || 'missing',
          expectedVersion,
        }),
        {
          status: 410, // 410 Gone - resource no longer available
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        }
      )
    }
  }

  // Request allowed - pass through
  return undefined
}

// Configure which routes this middleware applies to
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - Static files (*.css, *.js, *.png, etc.)
     * - Vite assets (@vite, src/, node_modules/)
     * - Favicon
     */
    '/((?!@vite|src/|node_modules/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|eot)$).*)',
  ],
}
