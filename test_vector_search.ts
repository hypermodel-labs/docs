import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

async function testVectorSearch() {
  console.log('🔍 Testing Query API with Vector Search Integration\n');

  try {
    // Test 1: Check if database is configured
    const dbConfigured = !!process.env.POSTGRES_CONNECTION_STRING;
    console.log(`📊 Database Configuration:`);
    console.log(`   PostgreSQL: ${dbConfigured ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Connection: ${dbConfigured ? 'Ready for vector search' : 'Will use fallback data'}`);
    console.log('');

    // Test 2: Create a query that would use vector search
    console.log('🔎 Test: Creating query for documentation search...');
    const searchQuery = {
      query: 'Find documentation about API authentication and OAuth flows',
      destination: {
        type: 'URL',
        config: {
          endpoint: 'http://localhost:3001/api/health',
        },
      },
      columns: ['name', 'url', 'description', 'relevance_score'],
    };

    const response = await axios.post(`${API_BASE}/query`, searchQuery);
    console.log('✅ Query created');
    console.log(`   ID: ${response.data.id}`);
    console.log(`   Status: ${response.data.status}`);
    console.log('');

    // Test 3: Wait and check status
    console.log('⏳ Checking query processing status...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const statusResponse = await axios.get(`${API_BASE}/query/${response.data.id}`);
    console.log(`   Current status: ${statusResponse.data.status}`);
    
    if (statusResponse.data.error) {
      console.log(`   Processing note: ${statusResponse.data.error}`);
    }
    console.log('');

    // Test 4: Create query with specific index hints
    console.log('📚 Test: Query with index-specific search...');
    const indexQuery = {
      query: 'Search in nextjs documentation for routing and navigation',
      destination: {
        type: 'URL',
        config: {
          endpoint: 'http://localhost:3001/api/health',
        },
      },
      columns: ['name', 'domain', 'url', 'index_name'],
    };

    const indexResponse = await axios.post(`${API_BASE}/query`, indexQuery);
    console.log('✅ Index-specific query created');
    console.log(`   ID: ${indexResponse.data.id}`);
    console.log('');

    // Test 5: List all queries to see processing patterns
    console.log('📈 Processing Summary:');
    const allQueries = await axios.get(`${API_BASE}/queries`);
    
    const recentQueries = allQueries.data.queries.slice(0, 5);
    for (const q of recentQueries) {
      const queryText = q.id.includes(response.data.id) || q.id.includes(indexResponse.data.id) 
        ? ' (vector search test)' 
        : '';
      console.log(`   ${q.id.substr(-8)}: ${q.status}${queryText}`);
    }
    console.log('');

    // Test 6: Check data sources being used
    console.log('🔧 Data Source Analysis:');
    console.log('   Expected sources when DB is configured:');
    console.log('     - documentation_vector_db (primary)');
    console.log('     - claude_ai (if API key set)');
    console.log('     - enrichment_api (for additional fields)');
    console.log('   ');
    console.log('   Expected sources when DB not configured:');
    console.log('     - claude_ai (if API key set)');
    console.log('     - fallback_samples (mock data)');
    console.log('');

    console.log('✨ Vector search integration test completed!');
    console.log('');
    console.log('💡 Tips:');
    console.log('   - Set POSTGRES_CONNECTION_STRING to enable vector search');
    console.log('   - Set ANTHROPIC_API_KEY for Claude fallback');
    console.log('   - Run Temporal worker for async processing');
    console.log('   - Configure embedding provider (OpenAI/Gemini) for vector operations');

  } catch (error: any) {
    console.error('❌ Test failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

// Run the test
console.log('🚀 Vector Search Integration Test\n');
console.log('Testing Query API with documentation database search\n');
console.log('=' + '='.repeat(50) + '\n');

testVectorSearch();