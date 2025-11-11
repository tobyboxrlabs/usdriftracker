import { 
  logError, 
  logWarning, 
  logInfo, 
  createErrorResponse, 
  generateRequestId,
  type ErrorLogContext 
} from './errorLogger'

export default async function handler(req: any, res: any) {
  // Top-level error handler to catch any initialization errors
  try {
    // Generate unique request ID for tracking
    const requestId = generateRequestId()
    
    // Create context for logging
    const context: ErrorLogContext = {
      endpoint: '/api/analytics',
      method: req.method || 'UNKNOWN',
      userAgent: req.headers['user-agent'],
      ip: req.headers['x-forwarded-for']?.toString().split(',')[0] || req.headers['x-real-ip']?.toString() || 'unknown',
    }
    
    // Add request ID to response headers
    res.setHeader('X-Request-ID', requestId)
    
    if (req.method !== 'GET') {
      logWarning('Method not allowed', context, requestId)
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: 'Only GET requests are supported',
        requestId 
      })
    }

    // Try multiple possible environment variable names
    const apiToken = process.env.VERCEL_API_TOKEN || process.env.VITE_VERCEL_API_TOKEN
    
    if (!apiToken) {
      // Analytics is optional - return empty data instead of error
      logWarning('VERCEL_API_TOKEN not configured - returning empty analytics', context, requestId)
      return res.status(200).json({ 
        totalDeployments: 0,
        latestDeployment: null,
        requestId,
        message: 'Analytics not configured'
      })
    }

    try {
      logInfo('Fetching deployment analytics', context, requestId)
      
      const baseUrl = 'https://api.vercel.com'
      
      // Get project ID - try environment first, then fetch from API
      let projectId = process.env.VERCEL_PROJECT_ID
      const teamId = process.env.VERCEL_TEAM_ID

      // If project ID not in env, fetch it from projects API
      if (!projectId) {
        const projectsUrl = teamId 
          ? `${baseUrl}/v9/projects?teamId=${teamId}&limit=1`
          : `${baseUrl}/v9/projects?limit=1`
        
        const projectsResponse = await fetch(projectsUrl, {
          headers: {
            Authorization: `Bearer ${apiToken}`,
          },
        })

        if (projectsResponse.ok) {
          const projectsData = await projectsResponse.json()
          if (projectsData.projects && projectsData.projects.length > 0) {
            projectId = projectsData.projects[0].id
            logInfo('Project ID fetched from API', context, requestId, { projectId })
          }
        } else {
          logWarning('Failed to fetch project from Vercel API', context, requestId)
        }
      }

      if (!projectId) {
        logError(new Error('Project ID not found'), context, requestId)
        return res.status(500).json({ 
          error: 'Configuration error',
          message: 'Analytics service configuration is incomplete',
          requestId
        })
      }
      
      // Fetch deployments to get count
      let deploymentsUrl = `${baseUrl}/v6/deployments?projectId=${projectId}&limit=100`
      if (teamId) {
        deploymentsUrl += `&teamId=${teamId}`
      }

      const deploymentsResponse = await fetch(deploymentsUrl, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!deploymentsResponse.ok) {
        const errorText = await deploymentsResponse.text()
        logError(
          new Error(`Vercel API returned ${deploymentsResponse.status}`),
          { ...context, status: deploymentsResponse.status, responsePreview: errorText.substring(0, 100) },
          requestId
        )
        
        return res.status(deploymentsResponse.status).json({ 
          error: 'External API error',
          message: 'Failed to fetch deployment information',
          requestId
        })
      }

      const deploymentsData = await deploymentsResponse.json()
      const deployments = deploymentsData.deployments || []
      
      // Get latest deployment info
      const latestDeployment = deployments[0] || null
      
      logInfo('Deployment analytics fetched successfully', context, requestId, {
        totalDeployments: deployments.length,
        hasLatest: !!latestDeployment
      })

      return res.status(200).json({
        totalDeployments: deployments.length,
        latestDeployment: latestDeployment ? {
          url: latestDeployment.url,
          createdAt: latestDeployment.createdAt,
          state: latestDeployment.state,
          environment: latestDeployment.target,
        } : null,
        requestId,
      })
    } catch (error) {
      // Log detailed error server-side
      logError(error, { ...context, operation: 'fetchDeployments' }, requestId)
      
      // Return safe error response to client
      const errorResponse = createErrorResponse(
        error,
        requestId,
        'Failed to fetch deployment analytics. Please try again later.'
      )
      
      return res.status(500).json(errorResponse)
    }
  } catch (topLevelError) {
    // Catch any errors that occur before we can set up proper error handling
    console.error('[analytics] Top-level error:', topLevelError)
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

