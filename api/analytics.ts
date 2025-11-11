import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Top-level error handler to catch any initialization errors
  try {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    
    if (req.method !== 'GET') {
      return res.status(405).json({ 
        error: 'Method not allowed',
        message: 'Only GET requests are supported'
      })
    }

    // Try multiple possible environment variable names
    const apiToken = process.env.VERCEL_API_TOKEN || process.env.VITE_VERCEL_API_TOKEN
    
    if (!apiToken) {
      // Analytics is optional - return empty data instead of error
      console.log('[analytics] VERCEL_API_TOKEN not configured - returning empty analytics')
      return res.status(200).json({ 
        totalDeployments: 0,
        latestDeployment: null,
        message: 'Analytics not configured'
      })
    }

    try {
      console.log('[analytics] Fetching deployment analytics')
      
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
            console.log('[analytics] Project ID fetched from API:', projectId)
          }
        } else {
          console.warn('[analytics] Failed to fetch project from Vercel API')
        }
      }

      if (!projectId) {
        console.error('[analytics] Project ID not found')
        return res.status(500).json({ 
          error: 'Configuration error',
          message: 'Analytics service configuration is incomplete'
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
        console.error('[analytics] Vercel API error:', deploymentsResponse.status, errorText.substring(0, 100))
        
        return res.status(deploymentsResponse.status).json({ 
          error: 'External API error',
          message: 'Failed to fetch deployment information'
        })
      }

      const deploymentsData = await deploymentsResponse.json()
      const deployments = deploymentsData.deployments || []
      
      // Get latest deployment info
      const latestDeployment = deployments[0] || null
      
      console.log('[analytics] Deployment analytics fetched successfully:', {
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
      })
    } catch (error) {
      console.error('[analytics] Error fetching deployments:', error)
      
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch deployment analytics'
      })
    }
  } catch (topLevelError) {
    // Catch any errors that occur before we can set up proper error handling
    console.error('[analytics] Top-level error:', topLevelError)
    const errorMessage = topLevelError instanceof Error ? topLevelError.message : String(topLevelError)
    
    // Try to set headers even on error
    try {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Content-Type', 'application/json')
    } catch {}
    
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      ...(process.env.NODE_ENV === 'development' && { details: errorMessage })
    })
  }
}

