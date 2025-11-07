export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Try multiple possible environment variable names
  const apiToken = process.env.VERCEL_API_TOKEN || process.env.VITE_VERCEL_API_TOKEN
  
  if (!apiToken) {
    console.error('VERCEL_API_TOKEN environment variable not found')
    console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('VERCEL') || k.includes('TOKEN')))
    return res.status(500).json({ 
      error: 'Vercel API token not configured',
      message: 'Please set VERCEL_API_TOKEN in Vercel project settings → Environment Variables'
    })
  }

  try {
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
        }
      }
    }

    if (!projectId) {
      return res.status(500).json({ 
        error: 'Project ID not found',
        message: 'Could not determine project ID from environment or API'
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
      console.error('Vercel API error:', deploymentsResponse.status, errorText)
      return res.status(deploymentsResponse.status).json({ 
        error: 'Failed to fetch deployments',
        status: deploymentsResponse.status,
        details: errorText 
      })
    }

    const deploymentsData = await deploymentsResponse.json()
    const deployments = deploymentsData.deployments || []
    
    // Get latest deployment info
    const latestDeployment = deployments[0] || null

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
    console.error('Error fetching deployments:', error)
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

