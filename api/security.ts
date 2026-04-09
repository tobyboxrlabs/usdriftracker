import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Security utilities for API endpoints
 * Implements CORS, input validation, and rate limiting
 */

// ============================================================================
// CORS Configuration
// ============================================================================

/**
 * Get allowed origins from environment variable
 * Format: comma-separated list of origins
 * Example: "https://usdriftracker.vercel.app,https://usdriftracker.com"
 * 
 * SECURITY: Never allows wildcard defaults - requires explicit configuration
 */
function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS

  // REQUIRE explicit configuration - NEVER allow wildcard defaults
  if (!envOrigins) {
    if (process.env.NODE_ENV === 'development') {
      // Development: localhost / 127.0.0.1 on common Vite + Vercel dev ports (5174+ when 5173 is taken)
      const ports = [3000, 5173, 5174, 5175, 5176, 4173, 4174, 8080]
      const origins: string[] = []
      for (const port of ports) {
        origins.push(`http://localhost:${port}`, `http://127.0.0.1:${port}`)
      }
      return origins
    } else {
      // Production: block all CORS unless explicitly configured
      console.warn('[security] ALLOWED_ORIGINS not configured - CORS disabled')
      return []
    }
  }

  const origins = envOrigins.split(',').map(o => o.trim()).filter(Boolean)

  // Validate origin formats - reject invalid formats
  for (const origin of origins) {
    if (origin !== '*' && !origin.startsWith('http://') && !origin.startsWith('https://')) {
      console.warn(`[security] Invalid origin format: ${origin}`)
      return [] // Fail securely
    }
  }

  return origins
}

/**
 * Set secure CORS headers based on request origin
 * Only allows explicitly configured origins - never uses wildcard
 */
export function setCorsHeaders(req: VercelRequest, res: VercelResponse): void {
  const allowedOrigins = getAllowedOrigins()
  const requestOrigin = req.headers.origin

  // Only allow explicitly configured origins (wildcard removed for security)
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  // If origin doesn't match, don't set CORS header (browser will block)

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400') // 24 hours
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate and sanitize player name
 * - Trims whitespace
 * - Limits length to 50 characters
 * - Removes potentially dangerous characters (HTML/script tags)
 * - Returns 'Anonymous' if invalid or empty
 */
export function validatePlayerName(name: unknown): string {
  if (!name || typeof name !== 'string') {
    return 'Anonymous'
  }

  // Trim and limit length
  const trimmed = name.trim().slice(0, 50)

  // Remove potentially dangerous characters (HTML tags, quotes, etc.)
  const sanitized = trimmed
    .replace(/[<>\"'&]/g, '') // Remove HTML/script characters
    .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
    .trim()

  // Ensure it's not empty after sanitization
  return sanitized || 'Anonymous'
}

/**
 * Validate timezone string against IANA timezone database
 * - Checks if timezone is valid using Intl.DateTimeFormat
 * - Limits length to 50 characters
 * - Returns undefined if invalid
 */
export function validateTimezone(tz: unknown): string | undefined {
  if (!tz || typeof tz !== 'string') {
    return undefined
  }

  const trimmed = tz.trim().slice(0, 50)

  if (!trimmed) {
    return undefined
  }

  // Validate against IANA timezone database
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed })
    return trimmed
  } catch {
    // Invalid timezone
    return undefined
  }
}

/**
 * Validate score value
 * - Must be a finite number
 * - Must be non-negative
 * - Must be within reasonable bounds (0 to 1 billion)
 */
export function validateScore(score: unknown): { valid: boolean; value?: number; error?: string } {
  if (typeof score !== 'number') {
    return { valid: false, error: 'Score must be a number' }
  }

  if (!Number.isFinite(score)) {
    return { valid: false, error: 'Score must be a finite number' }
  }

  if (score < 0) {
    return { valid: false, error: 'Score must be non-negative' }
  }

  if (score > 1e9) {
    return { valid: false, error: 'Score exceeds maximum allowed value' }
  }

  return { valid: true, value: score }
}

// ============================================================================
// Rate Limiting
// ============================================================================

interface RateLimitRecord {
  count: number
  resetTime: number
}

// In-memory rate limit store (resets on serverless function restart)
// For production at scale, consider using Redis or Vercel Edge Config
const rateLimitMap = new Map<string, RateLimitRecord>()

/**
 * Check if request should be rate limited
 * @param identifier - Unique identifier (IP address, user ID, etc.)
 * @param limit - Maximum number of requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000 // 1 minute default
): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(identifier)

  // Clean up expired entries periodically (every 100 checks)
  if (rateLimitMap.size > 1000) {
    for (const [key, value] of rateLimitMap.entries()) {
      if (now > value.resetTime) {
        rateLimitMap.delete(key)
      }
    }
  }

  // No record or expired - create new record
  if (!record || now > record.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + windowMs })
    return true
  }

  // Check if limit exceeded
  if (record.count >= limit) {
    return false
  }

  // Increment count
  record.count++
  return true
}

/**
 * Get client IP address from request headers
 * Handles Vercel's proxy headers
 */
export function getClientIp(req: VercelRequest): string {
  // Vercel sets x-forwarded-for with client IP
  const forwardedFor = req.headers['x-forwarded-for']
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, first one is the client
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor.split(',')[0]
    return ips.trim()
  }

  // Fallback to x-real-ip or connection remote address
  const realIp = req.headers['x-real-ip']
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp
  }

  return 'unknown'
}

// ============================================================================
// Request Size Validation
// ============================================================================

/**
 * Validate request body size
 * @param contentLength - Content-Length header value
 * @param maxSizeBytes - Maximum allowed size in bytes (default: 10KB)
 */
export function validateRequestSize(
  contentLength: string | undefined,
  maxSizeBytes: number = 10240 // 10KB default
): { valid: boolean; error?: string } {
  if (!contentLength) {
    return { valid: true } // No size specified, let Vercel handle it
  }

  const size = parseInt(contentLength, 10)
  if (isNaN(size) || size < 0) {
    return { valid: false, error: 'Invalid Content-Length header' }
  }

  if (size > maxSizeBytes) {
    return { valid: false, error: `Request body exceeds maximum size of ${maxSizeBytes} bytes` }
  }

  return { valid: true }
}

// ============================================================================
// Security Headers
// ============================================================================

/**
 * Set security headers for API responses
 */
export function setSecurityHeaders(res: VercelResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-XSS-Protection', '1; mode=block')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}
