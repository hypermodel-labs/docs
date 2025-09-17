import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

async function testQueryProcessing() {
  console.log('🔬 Testing Query Processing with Real Data...\n');

  try {
    // Test with a webhook.site endpoint for real testing
    console.log('📊 Creating a real query for data extraction...');
    
    const testQuery = {
      query: 'Find 5 AI startups in Series A stage focusing on healthcare',
      destination: {
        type: 'URL',
        config: {
          // Using httpbin.org as a test endpoint that accepts POST requests
          endpoint: 'https://httpbin.org/post',
          headers: {
            'X-Test-Header': 'query-api-test',
          },
        },
      },
      columns: ['name', 'domain', 'industry', 'funding_round', 'ceo_name', 'ceo_linkedin'],
    };

    console.log('📮 Submitting query:', testQuery.query);
    const createResponse = await axios.post(`${API_BASE}/query`, testQuery);
    const queryId = createResponse.data.id;
    console.log(`✅ Query created with ID: ${queryId}`);
    console.log(`   Initial status: ${createResponse.data.status}`);
    console.log('');

    // Poll for completion
    console.log('⏳ Waiting for query to process...');
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds timeout
    let finalStatus = null;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      const statusResponse = await axios.get(`${API_BASE}/query/${queryId}`);
      const status = statusResponse.data.status;
      
      if (status !== 'pending' && status !== 'processing') {
        finalStatus = statusResponse.data;
        break;
      }
      
      if (attempts % 5 === 0) {
        console.log(`   Still ${status}... (${attempts}s elapsed)`);
      }
      
      attempts++;
    }

    if (finalStatus) {
      console.log('\n📈 Query Processing Complete!');
      console.log('   Status:', finalStatus.status);
      console.log('   Destination:', finalStatus.destination);
      
      if (finalStatus.status === 'completed') {
        console.log('   ✅ Data successfully sent to:', finalStatus.destination.url || finalStatus.destination.type);
      } else if (finalStatus.error) {
        console.log('   ⚠️ Error:', finalStatus.error);
      }
    } else {
      console.log('   ⏱️ Query still processing after 30 seconds');
    }

    console.log('\n');

    // Test direct processing (without Temporal)
    console.log('🔄 Testing direct processing fallback...');
    
    const directQuery = {
      query: 'Get 3 fintech companies in seed stage',
      destination: {
        type: 'URL',
        config: {
          endpoint: 'https://httpbin.org/status/200', // Simple endpoint that returns 200 OK
        },
      },
      columns: ['name', 'domain', 'industry'],
    };

    const directResponse = await axios.post(`${API_BASE}/query`, directQuery);
    console.log(`✅ Direct query created: ${directResponse.data.id}`);
    
    // Check final status
    await new Promise(resolve => setTimeout(resolve, 3000));
    const directStatus = await axios.get(`${API_BASE}/query/${directResponse.data.id}`);
    console.log(`   Final status: ${directStatus.data.status}`);
    
    console.log('\n✨ Query processing tests completed!');
    
    // Show all queries
    console.log('\n📋 Summary of all queries:');
    const allQueries = await axios.get(`${API_BASE}/queries`);
    console.log(`   Total queries created: ${allQueries.data.total}`);
    
    const statuses = allQueries.data.queries.reduce((acc: any, q: any) => {
      acc[q.status] = (acc[q.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log('   Status breakdown:', statuses);
    
  } catch (error: any) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    if (error.response?.data?.details) {
      console.error('   Details:', error.response.data.details);
    }
    process.exit(1);
  }
}

// Run the test
console.log('🚀 Query Processing Integration Test\n');
console.log('This test will submit real queries and verify processing\n');
console.log('=' + '='.repeat(50) + '\n');

testQueryProcessing();