const axios = require('axios');

const API_BASE = 'http://localhost:3001/api/v1';

// Example 1: Extract company information from a PDF
async function extractCompanyInfo() {
  try {
    const response = await axios.post(`${API_BASE}/pdf/extract`, {
      pdfUrl: 'https://example.com/company-report.pdf',
      schema: {
        company_name: 'string',
        founded_year: 'number',
        ceo_name: 'string',
        revenue: 'number',
        employees: 'number',
        industry: 'string',
        products: ['string'],
        contact: {
          email: 'string',
          phone: 'string',
          address: 'string'
        }
      },
      options: {
        chunkSize: 2000,
        overlap: 200,
        maxChunks: 20
      }
    });

    console.log('Extraction successful:', response.data);
    return response.data;
  } catch (error) {
    console.error('Extraction failed:', error.response?.data || error.message);
  }
}

// Example 2: Extract financial data from quarterly report
async function extractFinancialData() {
  try {
    const response = await axios.post(`${API_BASE}/pdf/extract`, {
      pdfUrl: 'https://example.com/quarterly-report.pdf',
      schema: {
        quarter: 'string',
        year: 'number',
        revenue: {
          total: 'number',
          byProduct: {
            software: 'number',
            services: 'number',
            hardware: 'number'
          }
        },
        expenses: {
          operational: 'number',
          marketing: 'number',
          rd: 'number'
        },
        netIncome: 'number',
        eps: 'number',
        guidance: {
          nextQuarter: 'number',
          fullYear: 'number'
        }
      }
    });

    console.log('Financial data extracted:', response.data);
    return response.data;
  } catch (error) {
    console.error('Extraction failed:', error.response?.data || error.message);
  }
}

// Example 3: Extract to Clay
async function extractToClay() {
  try {
    const response = await axios.post(
      `${API_BASE}/pdf/extract/clay`,
      {
        pdfUrl: 'https://example.com/investor-deck.pdf',
        schema: {
          company_name: 'string',
          funding_stage: 'string',
          amount_raised: 'number',
          investors: ['string'],
          valuation: 'number',
          metrics: {
            arr: 'number',
            growth_rate: 'number',
            burn_rate: 'number'
          }
        }
      },
      {
        headers: {
          'X-Clay-Request-ID': 'clay_req_12345',
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('Data sent to Clay:', response.data);
    return response.data;
  } catch (error) {
    console.error('Clay integration failed:', error.response?.data || error.message);
  }
}

// Run examples
(async () => {
  console.log('=== Example 1: Extract Company Info ===');
  await extractCompanyInfo();

  console.log('\n=== Example 2: Extract Financial Data ===');
  await extractFinancialData();

  console.log('\n=== Example 3: Extract to Clay ===');
  await extractToClay();
})();