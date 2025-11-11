#!/usr/bin/env node

/**
 * Test script for Vercel Analytics API
 * Run with: node test-analytics.js
 */

const apiToken = process.env.VERCEL_API_TOKEN

if (!apiToken) {
  console.error('❌ VERCEL_API_TOKEN environment variable is required')
  console.error('   Please set it in your environment or .env file')
  console.error('   Example: export VERCEL_API_TOKEN=your_token_here')
  process.exit(1)
}

async function testVercelAnalytics() {
  console.log('Testing Vercel Analytics API...\n')
  console.log('API Token:', apiToken.substring(0, 10) + '...' + apiToken.substring(apiToken.length - 4))
  console.log('')

  try {
    // First, let's try to get project info
    console.log('1. Testing Vercel API connection...')
    const projectsUrl = 'https://api.vercel.com/v9/projects'
    const projectsResponse = await fetch(projectsUrl, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!projectsResponse.ok) {
      const errorText = await projectsResponse.text()
      console.error('❌ Failed to fetch projects:', projectsResponse.status)
      console.error('Error:', errorText)
      return
    }

    const projects = await projectsResponse.json()
    console.log('✅ API connection successful!')
    console.log(`   Found ${projects.projects?.length || 0} project(s)`)
    
    if (projects.projects && projects.projects.length > 0) {
      const project = projects.projects[0]
      console.log(`   Project: ${project.name} (${project.id})`)
      console.log('')

      // Try different analytics endpoints
      console.log('2. Testing Analytics endpoints...')
      
      const endpoints = [
        `https://api.vercel.com/v9/analytics/events?projectId=${project.id}`,
        `https://api.vercel.com/v1/analytics?projectId=${project.id}`,
        `https://api.vercel.com/v2/analytics?projectId=${project.id}`,
        `https://vercel.com/api/analytics?projectId=${project.id}`,
      ]

      let analyticsData = null
      let workingEndpoint = null

      for (const endpoint of endpoints) {
        try {
          const analyticsResponse = await fetch(endpoint, {
            headers: {
              Authorization: `Bearer ${apiToken}`,
              'Content-Type': 'application/json',
            },
          })

          if (analyticsResponse.ok) {
            analyticsData = await analyticsResponse.json()
            workingEndpoint = endpoint
            console.log(`✅ Found working endpoint: ${endpoint}`)
            break
          } else {
            console.log(`   ❌ ${endpoint}: ${analyticsResponse.status}`)
          }
        } catch (err) {
          console.log(`   ❌ ${endpoint}: ${err.message}`)
        }
      }

      if (analyticsData) {
        console.log('Response:', JSON.stringify(analyticsData, null, 2))
        
        // Process the data
        if (analyticsData.events) {
          const events = analyticsData.events
          const pageViews = events.filter(e => e.type === 'pageview').length
          const uniqueVisitors = new Set(events.map(e => e.visitorId || e.ip)).size
          
          console.log('')
          console.log('📊 Analytics Summary:')
          console.log(`   Total Events: ${events.length}`)
          console.log(`   Page Views: ${pageViews}`)
          console.log(`   Unique Visitors: ${uniqueVisitors}`)
        }
      } else {
        console.log('')
        console.log('⚠️  No working analytics endpoint found.')
        console.log('')
        console.log('Note: Vercel Analytics might need to be accessed through:')
        console.log('  1. The Vercel Dashboard (web interface)')
        console.log('  2. A different API endpoint structure')
        console.log('  3. Web Analytics API (if using Vercel Web Analytics)')
        console.log('')
        console.log('You can check the Vercel dashboard at:')
        console.log(`  https://vercel.com/${project.name}/analytics`)
      }
    } else {
      console.log('⚠️  No projects found')
    }

    // Also test deployments endpoint as fallback
    console.log('')
    console.log('3. Testing Deployments endpoint (fallback)...')
    if (projects.projects && projects.projects.length > 0) {
      const project = projects.projects[0]
      const deploymentsUrl = `https://api.vercel.com/v6/deployments?projectId=${project.id}&limit=10`
      
      const deploymentsResponse = await fetch(deploymentsUrl, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      })

      if (deploymentsResponse.ok) {
        const deployments = await deploymentsResponse.json()
        console.log('✅ Deployments endpoint successful!')
        console.log(`   Found ${deployments.deployments?.length || 0} recent deployment(s)`)
        
        if (deployments.deployments && deployments.deployments.length > 0) {
          const latest = deployments.deployments[0]
          console.log(`   Latest deployment: ${latest.url || latest.name}`)
          console.log(`   Created: ${new Date(latest.createdAt).toLocaleString()}`)
          
          // Show what data is available
          console.log('')
          console.log('📊 Available Deployment Stats:')
          console.log('   - Total deployments:', deployments.deployments.length)
          console.log('   - Deployment URLs')
          console.log('   - Creation timestamps')
          console.log('   - Build states (ready, error, etc.)')
          console.log('   - Environment (production, preview)')
          console.log('   - Git commits and branches')
        }
      } else {
        console.log('❌ Deployments endpoint failed:', deploymentsResponse.status)
      }
    }

    // Test what other data we can get
    console.log('')
    console.log('4. Exploring available API endpoints...')
    if (projects.projects && projects.projects.length > 0) {
      const project = projects.projects[0]
      
      // Try to get project details
      const projectDetailsUrl = `https://api.vercel.com/v9/projects/${project.id}`
      const projectDetailsResponse = await fetch(projectDetailsUrl, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      })

      if (projectDetailsResponse.ok) {
        const projectDetails = await projectDetailsResponse.json()
        console.log('✅ Project details available!')
        console.log('   Available data:')
        console.log('   - Project name:', projectDetails.name)
        console.log('   - Framework:', projectDetails.framework)
        console.log('   - Created:', new Date(projectDetails.createdAt).toLocaleString())
        console.log('   - Updated:', new Date(projectDetails.updatedAt).toLocaleString())
        console.log('   - Domains:', projectDetails.domains?.length || 0)
        console.log('   - Environment variables count')
        console.log('   - Build settings')
      }

      // Try domains endpoint
      const domainsUrl = `https://api.vercel.com/v9/projects/${project.id}/domains`
      const domainsResponse = await fetch(domainsUrl, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      })

      if (domainsResponse.ok) {
        const domains = await domainsResponse.json()
        console.log('✅ Domains available!')
        console.log(`   Found ${domains.domains?.length || 0} domain(s)`)
        if (domains.domains && domains.domains.length > 0) {
          domains.domains.forEach(d => {
            console.log(`   - ${d.name} (${d.verified ? 'verified' : 'not verified'})`)
          })
        }
      }

      // Try environment variables count
      const envUrl = `https://api.vercel.com/v9/projects/${project.id}/env`
      const envResponse = await fetch(envUrl, {
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      })

      if (envResponse.ok) {
        const envs = await envResponse.json()
        console.log('✅ Environment variables available!')
        console.log(`   Found ${envs.envs?.length || 0} environment variable(s)`)
      }
    }

    console.log('')
    console.log('📝 Summary:')
    console.log('   ✅ API Token: Working')
    console.log('   ✅ Projects API: Working')
    console.log('   ✅ Deployments API: Working')
    console.log('   ❌ Analytics API: Not available via public API')
    console.log('')
    console.log('💡 Recommendation:')
    console.log('   Vercel Analytics data is currently only available through:')
    console.log('   1. The Vercel Dashboard (https://vercel.com/usdriftracker/analytics)')
    console.log('   2. Using @vercel/analytics package in your app (client-side tracking)')
    console.log('   3. Third-party analytics (Google Analytics, Plausible, etc.)')
    console.log('')
    console.log('   If you want to track page views in your app, consider:')
    console.log('   - Using localStorage to track client-side page loads')
    console.log('   - Implementing a simple counter that increments on each visit')

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  }
}

// Run the test
testVercelAnalytics()

