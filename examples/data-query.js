const axios = require('axios');

const API_BASE = 'http://localhost:3001/api/v1';

// Example 1: Query Series A companies for Clay export
async function querySeriesACompanies() {
  try {
    const response = await axios.post(`${API_BASE}/data/query`, {
      query: 'Find top 10 Series A companies that sell to the hospitality industry',
      columns: [
        'name',
        'domain',
        'ceo_linkedin',
        'ceo_phone_number',
        'funding_amount',
        'industry',
        'target_market'
      ],
      destination: {
        type: 'clay',
        config: {
          tableId: 'tbl_seriesA_hospitality'
        }
      },
      options: {
        maxRows: 10,
        enrichmentLevel: 'advanced',
        parallel: true
      }
    });

    console.log('Query job created:', response.data);
    return response.data.jobId;
  } catch (error) {
    console.error('Query failed:', error.response?.data || error.message);
  }
}

// Example 2: Query B2B SaaS companies to Google Sheets
async function queryB2BSaaSCompanies() {
  try {
    const response = await axios.post(`${API_BASE}/data/query`, {
      query: 'List B2B SaaS companies with 50-200 employees in the HR tech space',
      columns: [
        'company_name',
        'website',
        'employee_count',
        'founded_year',
        'headquarters',
        'key_products',
        'annual_revenue',
        'cto_name',
        'cto_email'
      ],
      destination: {
        type: 'sheets',
        config: {
          spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
          sheetName: 'HR Tech Companies'
        }
      },
      options: {
        maxRows: 50,
        enrichmentLevel: 'standard'
      }
    });

    console.log('Query job created:', response.data);
    return response.data.jobId;
  } catch (error) {
    console.error('Query failed:', error.response?.data || error.message);
  }
}

// Example 3: Query to webhook URL
async function queryToWebhook() {
  try {
    const response = await axios.post(`${API_BASE}/data/query`, {
      query: 'Find recently funded fintech startups in Europe',
      columns: [
        'company',
        'country',
        'funding_date',
        'funding_amount',
        'investors',
        'website',
        'description'
      ],
      destination: {
        type: 'url',
        config: {
          url: 'https://webhook.site/unique-url',
          headers: {
            'X-Custom-Header': 'fintech-data'
          }
        }
      },
      options: {
        maxRows: 25,
        enrichmentLevel: 'basic'
      }
    });

    console.log('Query job created:', response.data);
    return response.data.jobId;
  } catch (error) {
    console.error('Query failed:', error.response?.data || error.message);
  }
}

// Check job status
async function checkJobStatus(jobId) {
  try {
    const response = await axios.get(`${API_BASE}/data/query/${jobId}/status`);
    console.log('Job status:', response.data);
    return response.data;
  } catch (error) {
    console.error('Status check failed:', error.response?.data || error.message);
  }
}

// Poll job until completion
async function waitForJob(jobId, maxAttempts = 30, delayMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    const status = await checkJobStatus(jobId);
    
    if (!status) return null;
    
    if (status.status === 'completed') {
      console.log('Job completed successfully!');
      return status;
    }
    
    if (status.status === 'failed') {
      console.log('Job failed:', status.metadata?.error);
      return status;
    }
    
    console.log(`Attempt ${i + 1}/${maxAttempts}: Status is ${status.status}`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  
  console.log('Job timed out');
  return null;
}

// Run examples
(async () => {
  console.log('=== Example 1: Query Series A Companies ===');
  const job1 = await querySeriesACompanies();
  if (job1) {
    console.log('Waiting for job to complete...');
    await waitForJob(job1);
  }

  console.log('\n=== Example 2: Query B2B SaaS Companies ===');
  const job2 = await queryB2BSaaSCompanies();
  if (job2) {
    console.log('Waiting for job to complete...');
    await waitForJob(job2);
  }

  console.log('\n=== Example 3: Query to Webhook ===');
  const job3 = await queryToWebhook();
  if (job3) {
    console.log('Waiting for job to complete...');
    await waitForJob(job3);
  }
})();