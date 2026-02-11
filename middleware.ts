import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextRequest, NextResponse } from '@vercel/edge'

/**
 * Edge Middleware for IP-based rate limiting
 * Blocks requests at the edge before they reach API endpoints
 * 
 * Rate Limits:
 * - API endpoints (/api/*): 60 requests per minute per IP
 * - Static assets: No rate limiting (allow all)
 */

// Initialize Upstash Redis client (works with Vercel KV/Upstash)
// Uses environment variables: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// Falls back to KV_REST_API_URL and KV_REST_API_TOKEN for backward compatibility
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '',
})

// Rate limit configuration
// Default: 60 requests per minute per IP
// Can be overridden via RATE_LIMIT_REQUESTS_PER_MINUTE environment variable
const RATE_LIMIT_REQUESTS = parseInt(process.env.RATE_LIMIT_REQUESTS_PER_MINUTE || '60', 10)

// Create rate limiter with sliding window algorithm
// More accurate than fixed window, prevents burst traffic
const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(RATE_LIMIT_REQUESTS, '1 m'),
  analytics: true, // Track rate limit hits
  prefix: '@ratelimit', // Redis key prefix
})

/**
 * Get client IP from request headers
 * Handles Vercel's proxy headers
 */
function getClientIp(request: NextRequest): string {
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

  // Use request IP from Vercel
  return request.ip || 'unknown'
}

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
 * Vercel Edge Middleware
 * Runs at the edge before requests reach your API endpoints
 */
export default async function middleware(request: NextRequest): Promise<NextResponse> {
  const pathname = request.nextUrl.pathname

  // Skip rate limiting for static assets and non-API routes
  // Only rate limit API endpoints
  if (!pathname.startsWith('/api/')) {
    // Let request pass through
    return NextResponse.next()
  }

  // Skip rate limiting for health check endpoints (if any)
  if (pathname === '/api/health' || pathname === '/api/healthz') {
    return NextResponse.next()
  }

  // Block old clients for /api/rpc endpoint
  // This prevents outdated clients from consuming resources
  if (pathname.startsWith('/api/rpc')) {
    const clientVersion = request.headers.get('x-client-version')
    const expectedVersion = getExpectedClientVersion()
    
    // Block if version is missing or doesn't match
    if (!clientVersion || clientVersion !== expectedVersion) {
      const clientIp = getClientIp(request)
      console.warn(
        `[middleware] 🚫 BLOCKING OLD CLIENT 🚫 IP: ${clientIp}, ` +
        `Client Version: ${clientVersion || 'MISSING'}, ` +
        `Expected: ${expectedVersion}, ` +
        `Path: ${pathname}`
      )
      
      // Return 410 Gone - resource no longer available
      // This tells the client (and browsers) that the resource is permanently gone
      return NextResponse.json(
        {
          error: 'Client version outdated',
          message: 'Please refresh your browser to get the latest version. This client version is no longer supported.',
          code: 'OUTDATED_CLIENT',
          clientVersion: clientVersion || 'missing',
          expectedVersion,
        },
        {
          status: 410, // 410 Gone - resource no longer available
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        }
      )
    }
  }

  // Get client IP
  const clientIp = getClientIp(request)

  // Skip rate limiting if IP cannot be determined (shouldn't happen in production)
  if (clientIp === 'unknown') {
    console.warn('[middleware] Could not determine client IP, allowing request')
    return NextResponse.next()
  }

  try {
    // Check rate limit
    const { success, limit, remaining, reset } = await ratelimit.limit(`ratelimit:${clientIp}`)

    if (!success) {
      // Log rate limit violations for monitoring
      console.warn(`[middleware] Rate limit exceeded for IP: ${clientIp}, path: ${pathname}`)

      // Return 429 Too Many Requests
      const retryAfter = Math.ceil((reset - Date.now()) / 1000) // seconds until reset
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
          retryAfter,
        },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': limit.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': reset.toString(),
            'Retry-After': retryAfter.toString(),
          },
        }
      )
    }

    // Request allowed - pass through with rate limit headers
    const response = NextResponse.next()
    response.headers.set('X-RateLimit-Limit', limit.toString())
    response.headers.set('X-RateLimit-Remaining', remaining.toString())
    response.headers.set('X-RateLimit-Reset', reset.toString())

    return response
  } catch (error) {
    // If Redis/rate limiting fails, log error but allow request
    // Better to allow traffic than block everything on Redis failure
    console.error('[middleware] Rate limit check failed, allowing request:', error)
    return NextResponse.next()
  }
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
