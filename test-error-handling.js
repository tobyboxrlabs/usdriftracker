#!/usr/bin/env node

/**
 * Test script for improved error handling
 * Tests both development and production error responses
 * Run with: node test-error-handling.js
 */

const TEST_SCENARIOS = [
  {
    name: 'Valid Score Submission',
    endpoint: '/api/scores',
    method: 'POST',
    body: { score: 100, playerName: 'TestUser' },
    expectStatus: 200,
    expectSuccess: true,
  },
  {
    name: 'Invalid Score (Negative)',
    endpoint: '/api/scores',
    method: 'POST',
    body: { score: -1, playerName: 'TestUser' },
    expectStatus: 400,
    expectError: true,
  },
  {
    name: 'Invalid Score (String)',
    endpoint: '/api/scores',
    method: 'POST',
    body: { score: 'invalid', playerName: 'TestUser' },
    expectStatus: 400,
    expectError: true,
  },
  {
    name: 'Fetch Leaderboard',
    endpoint: '/api/scores?limit=5',
    method: 'GET',
    expectStatus: 200,
    expectSuccess: true,
  },
  {
    name: 'Invalid Limit (Negative)',
    endpoint: '/api/scores?limit=-1',
    method: 'GET',
    expectStatus: 200, // Should sanitize to 1
    expectSuccess: true,
  },
  {
    name: 'Invalid Limit (Too Large)',
    endpoint: '/api/scores?limit=1000',
    method: 'GET',
    expectStatus: 200, // Should cap at 100
    expectSuccess: true,
  },
  {
    name: 'Wrong HTTP Method',
    endpoint: '/api/scores',
    method: 'DELETE',
    expectStatus: 405,
    expectError: true,
  },
  {
    name: 'Analytics Endpoint',
    endpoint: '/api/analytics',
    method: 'GET',
    expectStatus: [200, 500], // May fail if not configured
    expectSuccess: false, // Depends on config
  },
]

async function runTest(scenario, baseUrl) {
  console.log(`\n📋 Test: ${scenario.name}`)
  console.log(`   Endpoint: ${scenario.method} ${scenario.endpoint}`)
  
  try {
    const options = {
      method: scenario.method,
      headers: {
        'Content-Type': 'application/json',
      },
    }
    
    if (scenario.body) {
      options.body = JSON.stringify(scenario.body)
    }
    
    const response = await fetch(`${baseUrl}${scenario.endpoint}`, options)
    const contentType = response.headers.get('content-type')
    const requestId = response.headers.get('x-request-id')
    
    // Check for request ID header
    if (requestId) {
      console.log(`   ✅ Request ID: ${requestId}`)
    } else {
      console.log(`   ⚠️  No Request ID header found`)
    }
    
    // Check status
    const statusMatches = Array.isArray(scenario.expectStatus) 
      ? scenario.expectStatus.includes(response.status)
      : response.status === scenario.expectStatus
    
    if (statusMatches) {
      console.log(`   ✅ Status: ${response.status}`)
    } else {
      console.log(`   ❌ Status: ${response.status} (expected ${scenario.expectStatus})`)
    }
    
    // Parse response
    let data
    if (contentType && contentType.includes('application/json')) {
      data = await response.json()
      console.log(`   ✅ Valid JSON response`)
    } else {
      const text = await response.text()
      console.log(`   ⚠️  Non-JSON response: ${text.substring(0, 50)}`)
      return
    }
    
    // Check response structure
    if (data.requestId) {
      console.log(`   ✅ Response includes requestId`)
    }
    
    if (scenario.expectError) {
      if (data.error) {
        console.log(`   ✅ Error response: ${data.error}`)
      } else {
        console.log(`   ❌ Expected error response but got success`)
      }
      
      if (data.message) {
        console.log(`   ✅ Error message: ${data.message}`)
      }
      
      // Check that stack trace is NOT exposed
      if (data.stack || (data.details && data.details.includes('at '))) {
        console.log(`   ⚠️  WARNING: Stack trace may be exposed!`)
      } else {
        console.log(`   ✅ No stack trace in response (secure)`)
      }
    } else if (scenario.expectSuccess) {
      if (data.success || data.leaderboard || data.totalDeployments !== undefined) {
        console.log(`   ✅ Success response`)
      } else {
        console.log(`   ⚠️  Unexpected response structure`)
      }
    }
    
    // Log full response in verbose mode
    if (process.env.VERBOSE) {
      console.log(`   Full response:`, JSON.stringify(data, null, 2))
    }
    
  } catch (error) {
    console.log(`   ❌ Test failed: ${error.message}`)
  }
}

async function main() {
  console.log('🧪 Error Handling Test Suite\n')
  console.log('This tests the improved error logging and response handling.\n')
  
  // Determine base URL
  const baseUrl = process.env.TEST_URL || 'http://localhost:3000'
  console.log(`🌐 Testing against: ${baseUrl}\n`)
  console.log('💡 Tip: Set TEST_URL environment variable to test production')
  console.log('   Example: TEST_URL=https://your-app.vercel.app node test-error-handling.js\n')
  console.log('💡 Tip: Set VERBOSE=1 to see full response payloads\n')
  console.log('─'.repeat(70))
  
  // Run all tests
  for (const scenario of TEST_SCENARIOS) {
    await runTest(scenario, baseUrl)
  }
  
  console.log('\n' + '─'.repeat(70))
  console.log('\n✅ Test suite complete!\n')
  
  console.log('📊 Summary:')
  console.log('   - Check that all responses include Request IDs')
  console.log('   - Verify no stack traces are exposed')
  console.log('   - Confirm error messages are user-friendly')
  console.log('   - Validate status codes match expectations\n')
  
  console.log('🔍 Next Steps:')
  console.log('   1. Check server logs for structured error logging')
  console.log('   2. Verify production mode hides detailed errors')
  console.log('   3. Test with real deployment to verify NODE_ENV handling')
  console.log('   4. Monitor logs for any unexpected patterns\n')
}

// Run the test suite
main().catch(error => {
  console.error('❌ Test suite failed:', error)
  process.exit(1)
})

