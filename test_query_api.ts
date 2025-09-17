import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

async function testQueryAPI() {
  console.log('🧪 Testing Query API...\n');

  try {
    // Test 1: Health check
    console.log('1️⃣  Testing health endpoint...');
    const healthResponse = await axios.get(`${API_BASE}/health`);
    console.log('✅ Health check response:', healthResponse.data);
    console.log('');

    // Test 2: Create a query with URL destination
    console.log('2️⃣  Creating query with URL destination...');
    const urlQuery = {
      query: 'Give me the top 10 Series A companies that sell to the hospitality industry with the following columns: name, domain, ceo_linkedin, ceo_phone_number',
      destination: {
        type: 'URL',
        config: {
          endpoint: 'https://webhook.site/unique-id', // Replace with your webhook URL
          headers: {
            'X-API-Key': 'test-key',
          },
        },
      },
      columns: ['name', 'domain', 'ceo_linkedin', 'ceo_phone_number', 'industry', 'funding_round'],
    };

    const createResponse = await axios.post(`${API_BASE}/query`, urlQuery);
    console.log('✅ Query created:', createResponse.data);
    const queryId = createResponse.data.id;
    console.log('');

    // Test 3: Check query status
    console.log('3️⃣  Checking query status...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    const statusResponse = await axios.get(`${API_BASE}/query/${queryId}`);
    console.log('✅ Query status:', statusResponse.data);
    console.log('');

    // Test 4: Create a query with Sheets destination
    console.log('4️⃣  Creating query with Google Sheets destination...');
    const sheetsQuery = {
      query: 'Find 5 fintech startups in seed stage',
      destination: {
        type: 'Sheets',
        config: {
          spreadsheetId: 'your-spreadsheet-id',
          sheetName: 'Sheet1',
          accessToken: 'your-google-access-token', // Would need OAuth in production
        },
      },
      columns: ['name', 'domain', 'industry', 'funding_round', 'revenue'],
    };

    const sheetsResponse = await axios.post(`${API_BASE}/query`, sheetsQuery);
    console.log('✅ Sheets query created:', sheetsResponse.data);
    console.log('');

    // Test 5: Create a query with Clay destination
    console.log('5️⃣  Creating query with Clay destination...');
    const clayQuery = {
      query: 'Get 15 B2B SaaS companies with over 100 employees',
      destination: {
        type: 'Clay',
        config: {
          apiKey: 'your-clay-api-key',
          tableId: 'your-clay-table-id',
        },
      },
      columns: ['name', 'domain', 'employees', 'industry', 'ceo_email'],
    };

    const clayResponse = await axios.post(`${API_BASE}/query`, clayQuery);
    console.log('✅ Clay query created:', clayResponse.data);
    console.log('');

    // Test 6: List all queries
    console.log('6️⃣  Listing all queries...');
    const listResponse = await axios.get(`${API_BASE}/queries`);
    console.log(`✅ Total queries: ${listResponse.data.total}`);
    console.log('Recent queries:', listResponse.data.queries.slice(0, 3));
    console.log('');

    // Test 7: Test error handling with invalid request
    console.log('7️⃣  Testing error handling...');
    try {
      await axios.post(`${API_BASE}/query`, {
        query: '', // Empty query should fail validation
        destination: { type: 'InvalidType', config: {} },
      });
    } catch (error: any) {
      if (error.response?.status === 400) {
        console.log('✅ Validation error handled correctly:', error.response.data.error);
      } else {
        throw error;
      }
    }
    console.log('');

    console.log('✨ All tests completed successfully!');
  } catch (error: any) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run tests
console.log('🚀 Starting Query API Tests...\n');
console.log('Make sure the server is running on http://localhost:3001\n');
console.log('=' + '='.repeat(50) + '\n');

testQueryAPI();