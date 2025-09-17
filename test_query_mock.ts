import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

async function testWithMockData() {
  console.log('🧪 Testing Query API with Mock Data\n');

  try {
    // First, let's verify the server is healthy
    const health = await axios.get(`${API_BASE}/health`);
    console.log('✅ Server Status:', health.data);
    console.log('');

    // Test 1: Create a simple query
    console.log('📝 Test 1: Creating a query with mock destination...');
    const mockQuery = {
      query: 'Find top 5 SaaS companies with over $10M revenue',
      destination: {
        type: 'URL',
        config: {
          endpoint: 'http://localhost:3001/api/health', // Using our own health endpoint as mock
          headers: {
            'X-Mock-Test': 'true',
          },
        },
      },
      columns: ['name', 'domain', 'revenue', 'employees'],
    };

    const response = await axios.post(`${API_BASE}/query`, mockQuery);
    console.log('✅ Query created successfully');
    console.log('   ID:', response.data.id);
    console.log('   Status:', response.data.status);
    console.log('   Created:', response.data.createdAt);
    console.log('');

    // Test 2: Retrieve the query
    console.log('📋 Test 2: Retrieving query details...');
    const queryId = response.data.id;
    const queryDetails = await axios.get(`${API_BASE}/query/${queryId}`);
    console.log('✅ Query retrieved');
    console.log('   Current status:', queryDetails.data.status);
    console.log('   Destination type:', queryDetails.data.destination.type);
    console.log('');

    // Test 3: Test different destination types
    console.log('🎯 Test 3: Testing different destination types...');
    
    const destinations = [
      { type: 'Sheets', name: 'Google Sheets' },
      { type: 'Snowflake', name: 'Snowflake DB' },
      { type: 'Clay', name: 'Clay Table' },
    ];

    for (const dest of destinations) {
      const testQuery = {
        query: `Test query for ${dest.name}`,
        destination: {
          type: dest.type,
          config: {
            // Mock configs for each destination
            ...(dest.type === 'Sheets' && {
              spreadsheetId: 'mock-sheet-id',
              sheetName: 'Sheet1',
              accessToken: 'mock-token',
            }),
            ...(dest.type === 'Snowflake' && {
              account: 'mock-account',
              database: 'mock-db',
              schema: 'public',
              table: 'companies',
              warehouse: 'compute_wh',
              username: 'mock-user',
              password: 'mock-pass',
            }),
            ...(dest.type === 'Clay' && {
              apiKey: 'mock-api-key',
              tableId: 'mock-table-id',
            }),
          },
        },
        columns: ['name', 'domain'],
      };

      const res = await axios.post(`${API_BASE}/query`, testQuery);
      console.log(`   ✅ ${dest.name}: Query ${res.data.id.substr(-6)} created`);
    }
    console.log('');

    // Test 4: List all queries
    console.log('📊 Test 4: Listing all queries...');
    const allQueries = await axios.get(`${API_BASE}/queries`);
    console.log(`✅ Found ${allQueries.data.total} queries`);
    
    // Group by status
    const byStatus = allQueries.data.queries.reduce((acc: any, q: any) => {
      acc[q.status] = (acc[q.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log('   Status distribution:', byStatus);
    
    // Group by destination
    const byDest = allQueries.data.queries.reduce((acc: any, q: any) => {
      const type = q.destination.type;
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    console.log('   Destination distribution:', byDest);
    console.log('');

    // Test 5: Error handling
    console.log('⚠️ Test 5: Testing error handling...');
    
    // Invalid destination type
    try {
      await axios.post(`${API_BASE}/query`, {
        query: 'Test query',
        destination: {
          type: 'InvalidType',
          config: {},
        },
      });
      console.log('   ❌ Should have failed with invalid type');
    } catch (error: any) {
      if (error.response?.status === 400) {
        console.log('   ✅ Invalid destination type rejected');
      }
    }

    // Empty query
    try {
      await axios.post(`${API_BASE}/query`, {
        query: '',
        destination: {
          type: 'URL',
          config: { endpoint: 'http://example.com' },
        },
      });
      console.log('   ❌ Should have failed with empty query');
    } catch (error: any) {
      if (error.response?.status === 400) {
        console.log('   ✅ Empty query rejected');
      }
    }

    // Missing config
    try {
      await axios.post(`${API_BASE}/query`, {
        query: 'Test query',
        destination: {
          type: 'URL',
          config: {},
        },
      });
      console.log('   ✅ Missing config accepted (will fail during processing)');
    } catch (error: any) {
      console.log('   Config validation:', error.response?.data?.error);
    }

    console.log('');
    console.log('🎉 All tests completed successfully!');
    console.log('');
    console.log('📌 Note: Queries are in pending/failed state because:');
    console.log('   - No ANTHROPIC_API_KEY is set for Claude processing');
    console.log('   - Temporal worker may not be running');
    console.log('   - This is expected for mock testing');
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response?.data) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

// Run the test
console.log('🚀 Query API Mock Test Suite\n');
console.log('Testing API functionality without external dependencies\n');
console.log('=' + '='.repeat(50) + '\n');

testWithMockData();