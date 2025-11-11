# Error Logging Implementation Guide

## Overview

This application now uses a centralized, structured error logging system that follows security best practices:

- ✅ **No stack traces exposed to clients** in production
- ✅ **Structured logging** for easier monitoring and debugging
- ✅ **Request tracking** with unique request IDs
- ✅ **Safe error responses** that don't leak sensitive information
- ✅ **Audit trails** for important operations

## Architecture

### Core Components

1. **errorLogger.ts** - Centralized logging utility
2. **API Endpoints** - Uses the logging utility consistently
3. **Request IDs** - Every request gets a unique tracking ID

## Features

### 1. Request Tracking

Every API request gets a unique request ID that is:
- Logged server-side with all operations
- Returned in the response
- Added to response headers as `X-Request-ID`

**Example Response:**
```json
{
  "leaderboard": [...],
  "requestId": "req_1234567890_abc123"
}
```

This allows you to track a specific request through all logs.

### 2. Structured Logging

All logs follow a consistent JSON format:

```json
{
  "timestamp": "2024-11-11T12:34:56.789Z",
  "requestId": "req_1234567890_abc123",
  "level": "ERROR",
  "endpoint": "/api/scores",
  "method": "POST",
  "error": {
    "message": "Connection timeout",
    "name": "TimeoutError"
  },
  "context": {
    "userAgent": "Mozilla/5.0...",
    "ip": "192.168.1.1",
    "operation": "saveScore"
  }
}
```

### 3. Log Levels

#### ERROR
For actual errors that prevented an operation from completing:
```typescript
logError(error, context, requestId)
```

#### WARNING
For unexpected situations that didn't break functionality:
```typescript
logWarning('Invalid score submitted', context, requestId)
```

#### INFO
For successful operations and audit trails:
```typescript
logInfo('Score saved successfully', context, requestId, { score, playerName })
```

### 4. Safe Error Responses

Clients never receive:
- Stack traces
- Internal file paths
- Database details
- Environment information

**Development Mode:**
```json
{
  "error": "ValidationError",
  "message": "Score must be a positive number",
  "requestId": "req_1234567890_abc123",
  "timestamp": "2024-11-11T12:34:56.789Z"
}
```

**Production Mode:**
```json
{
  "error": "Internal Server Error",
  "message": "Failed to save score. Please try again later.",
  "requestId": "req_1234567890_abc123",
  "timestamp": "2024-11-11T12:34:56.789Z"
}
```

## Implementation Examples

### API Endpoint Pattern

```typescript
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Generate request ID
  const requestId = generateRequestId()
  
  // 2. Create logging context
  const context: ErrorLogContext = {
    endpoint: '/api/example',
    method: req.method || 'UNKNOWN',
    userAgent: req.headers['user-agent'],
    ip: req.headers['x-forwarded-for']?.toString().split(',')[0] || 'unknown',
  }
  
  // 3. Add request ID to response headers
  res.setHeader('X-Request-ID', requestId)
  
  try {
    // 4. Log the operation
    logInfo('Processing request', context, requestId)
    
    // ... your logic here ...
    
    // 5. Log success
    logInfo('Request processed successfully', context, requestId, { result: 'data' })
    
    return res.status(200).json({ success: true, requestId })
  } catch (error) {
    // 6. Log error server-side
    logError(error, { ...context, operation: 'specificOperation' }, requestId)
    
    // 7. Return safe error to client
    const errorResponse = createErrorResponse(
      error,
      requestId,
      'User-friendly error message'
    )
    
    return res.status(500).json(errorResponse)
  }
}
```

## Monitoring & Debugging

### Finding Errors

**By Request ID:**
```bash
# Search logs for specific request
grep "req_1234567890_abc123" logs.txt
```

**By Error Type:**
```bash
# Find all validation errors
grep '"level":"ERROR"' logs.txt | grep ValidationError
```

**By Endpoint:**
```bash
# Find all errors on /api/scores
grep '/api/scores' logs.txt | grep '"level":"ERROR"'
```

### Common Debugging Scenarios

#### Scenario 1: User reports error submitting score

1. Get the request ID from the error response they see
2. Search logs: `grep "req_..." logs.txt`
3. View full context of the request including:
   - When it happened
   - What IP/user agent
   - Exact error message
   - Stack trace (if in dev mode logs)

#### Scenario 2: High error rate detected

1. Search for ERROR level logs in time range
2. Group by error type/message
3. Identify pattern (same endpoint, same error, etc.)
4. Check for common context (IP address, user agent, etc.)

## Production Setup

### Environment Variables

Ensure `NODE_ENV` is set correctly:
```bash
NODE_ENV=production  # Hide detailed errors from clients
NODE_ENV=development # Show detailed errors for debugging
```

### Integrating with Logging Services

The `errorLogger.ts` file has placeholders for integrating with professional logging services:

**Sentry:**
```typescript
import * as Sentry from '@sentry/node'

if (isProduction) {
  Sentry.captureException(error, {
    tags: { requestId, endpoint: context.endpoint },
    extra: context,
  })
}
```

**Datadog:**
```typescript
import { datadogLogs } from '@datadog/browser-logs'

if (isProduction) {
  datadogLogs.logger.error(error.message, {
    requestId,
    context,
  })
}
```

**LogDNA/Mezmo:**
```typescript
import Logger from '@logdna/logger'

const logger = Logger.createLogger(process.env.LOGDNA_KEY)
logger.error(logEntry)
```

## Security Benefits

### Before Implementation
❌ Stack traces exposed to clients  
❌ Unstructured console.log everywhere  
❌ No request tracking  
❌ Debug info in production  
❌ Sensitive data in error messages  

### After Implementation
✅ Safe, generic errors for clients  
✅ Structured JSON logs  
✅ Request IDs for tracking  
✅ Production/development modes  
✅ Sanitized error messages  

## Testing

### Test Error Responses

**Valid Request:**
```bash
curl -X POST https://your-app.vercel.app/api/scores \
  -H "Content-Type: application/json" \
  -d '{"score": 100, "playerName": "Test"}'
```

**Invalid Request (triggers error):**
```bash
curl -X POST https://your-app.vercel.app/api/scores \
  -H "Content-Type: application/json" \
  -d '{"score": -1}'
```

**Check Response Headers:**
```bash
curl -I https://your-app.vercel.app/api/scores
# Look for: X-Request-ID: req_...
```

### Verify Production Safety

1. Deploy to staging/production
2. Trigger an error (invalid input)
3. Check client response - should NOT contain:
   - Stack traces
   - File paths
   - Database connection strings
   - Internal variable names
4. Check server logs - should contain full details

## Best Practices

### DO:
✅ Always generate and use request IDs  
✅ Log important operations (INFO level)  
✅ Log all errors (ERROR level)  
✅ Include relevant context in logs  
✅ Return user-friendly error messages  
✅ Use structured logging format  

### DON'T:
❌ Log sensitive data (passwords, tokens, full credit cards)  
❌ Expose stack traces to clients  
❌ Use console.log directly (use logInfo instead)  
❌ Log PII without redaction  
❌ Include internal implementation details in client errors  

## Maintenance

### Regular Tasks

1. **Review Logs Weekly**
   - Look for error patterns
   - Check for unexpected errors
   - Monitor error rates

2. **Rotate/Archive Logs**
   - Set up log rotation
   - Archive old logs
   - Keep recent logs accessible

3. **Update Error Messages**
   - Keep user-facing messages helpful
   - Avoid technical jargon
   - Provide actionable guidance

## Rate Limiting

The error logger includes basic rate limit tracking:

```typescript
// Check if client is hitting errors too frequently
if (checkErrorRateLimit(clientIp, 10, 60000)) {
  // Client has had 10+ errors in last 60 seconds
  // Consider temporary block or additional logging
}
```

## Future Enhancements

Potential improvements:
- [ ] Integration with Sentry/Datadog
- [ ] Automated alerting for error spikes
- [ ] Error trend analysis
- [ ] Automatic issue creation (GitHub, Jira)
- [ ] Performance metrics tracking
- [ ] User session tracking

---

**Status**: ✅ Implemented  
**Version**: 1.0  
**Last Updated**: 2024-11-11  
**Security Level**: Production-ready

