/**
 * Centralized error logging utility for API endpoints
 * Provides structured logging with security best practices
 */

export interface ErrorLogContext {
  endpoint: string
  method: string
  userAgent?: string
  ip?: string
  [key: string]: any
}

export interface ErrorResponse {
  error: string
  message: string
  requestId?: string
  timestamp?: string
}

/**
 * Generate a unique request ID for tracking
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`
}

/**
 * Log error to server console with structured format
 * Never exposes this information to clients
 */
export function logError(
  error: unknown,
  context: ErrorLogContext,
  requestId: string
): void {
  const timestamp = new Date().toISOString()
  const isProduction = process.env.NODE_ENV === 'production'
  
  // Structured error log for server-side debugging
  const logEntry = {
    timestamp,
    requestId,
    level: 'ERROR',
    endpoint: context.endpoint,
    method: context.method,
    error: {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'UnknownError',
      // Only include stack trace in development
      ...((!isProduction && error instanceof Error) && { stack: error.stack }),
    },
    context: {
      userAgent: context.userAgent,
      ip: context.ip,
      // Include any additional context
      ...Object.fromEntries(
        Object.entries(context).filter(([key]) => 
          !['endpoint', 'method', 'userAgent', 'ip'].includes(key)
        )
      ),
    },
  }
  
  // Log to console (in production, this should go to a logging service)
  console.error(JSON.stringify(logEntry, null, isProduction ? 0 : 2))
  
  // TODO: In production, send to logging service (Sentry, Datadog, etc.)
  // if (isProduction) {
  //   sendToLoggingService(logEntry)
  // }
}

/**
 * Log warning to server console with structured format
 */
export function logWarning(
  message: string,
  context: ErrorLogContext,
  requestId: string
): void {
  const timestamp = new Date().toISOString()
  const isProduction = process.env.NODE_ENV === 'production'
  
  const logEntry = {
    timestamp,
    requestId,
    level: 'WARNING',
    message,
    endpoint: context.endpoint,
    method: context.method,
    context,
  }
  
  console.warn(JSON.stringify(logEntry, null, isProduction ? 0 : 2))
}

/**
 * Create a safe error response for clients
 * Never exposes internal details, stack traces, or sensitive information
 */
export function createErrorResponse(
  error: unknown,
  requestId: string,
  defaultMessage: string = 'An error occurred'
): ErrorResponse {
  const isProduction = process.env.NODE_ENV === 'production'
  
  // In production, return generic messages only
  if (isProduction) {
    return {
      error: 'Internal Server Error',
      message: defaultMessage,
      requestId,
      timestamp: new Date().toISOString(),
    }
  }
  
  // In development, provide more details (but still no stack traces)
  return {
    error: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    requestId,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Log successful operations (for audit trails)
 */
export function logInfo(
  message: string,
  context: ErrorLogContext,
  requestId: string,
  additionalData?: Record<string, any>
): void {
  const timestamp = new Date().toISOString()
  const isProduction = process.env.NODE_ENV === 'production'
  
  const logEntry = {
    timestamp,
    requestId,
    level: 'INFO',
    message,
    endpoint: context.endpoint,
    method: context.method,
    ...additionalData,
  }
  
  // Only log INFO in development or if explicitly enabled
  if (!isProduction || process.env.ENABLE_INFO_LOGS === 'true') {
    console.log(JSON.stringify(logEntry, null, isProduction ? 0 : 2))
  }
}

/**
 * Sanitize error message to remove sensitive information
 */
export function sanitizeErrorMessage(message: string): string {
  // Remove potential file paths
  let sanitized = message.replace(/\/[^\s]+/g, '[PATH]')
  
  // Remove potential tokens/keys (look for long alphanumeric strings)
  sanitized = sanitized.replace(/[a-zA-Z0-9]{32,}/g, '[REDACTED]')
  
  // Remove URLs with credentials
  sanitized = sanitized.replace(/https?:\/\/[^:]+:[^@]+@/g, 'https://[CREDENTIALS]@')
  
  return sanitized
}

/**
 * Rate limit error for specific operations
 * Returns true if rate limit exceeded
 */
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()

export function checkErrorRateLimit(
  identifier: string,
  limit: number = 10,
  windowMs: number = 60000
): boolean {
  const now = Date.now()
  const record = rateLimitMap.get(identifier)
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(identifier, { count: 1, resetTime: now + windowMs })
    return false
  }
  
  if (record.count >= limit) {
    return true
  }
  
  record.count++
  return false
}

/**
 * Clean up old rate limit entries periodically
 * Skip in serverless environments (Vercel) where each invocation is stateless
 */
if (typeof process !== 'undefined' && !process.env.VERCEL) {
  // Only set up interval in non-serverless environments
  // In serverless, rate limit map will reset on each invocation anyway
  setInterval(() => {
    const now = Date.now()
    for (const [key, record] of rateLimitMap.entries()) {
      if (now > record.resetTime) {
        rateLimitMap.delete(key)
      }
    }
  }, 300000) // Clean up every 5 minutes
}

