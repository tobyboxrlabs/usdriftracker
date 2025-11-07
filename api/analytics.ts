export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiToken = process.env.VERCEL_API_TOKEN
  if (!apiToken) {
    return res.status(500).json({ error: 'Vercel API token not configured' })
  }

  try {
    // Get project ID from environment (Vercel provides this automatically)
    const projectId = process.env.VERCEL_PROJECT_ID
    const teamId = process.env.VERCEL_TEAM_ID

    if (!projectId) {
      return res.status(500).json({ error: 'Project ID not found' })
    }

    const baseUrl = 'https://api.vercel.com'
    
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

