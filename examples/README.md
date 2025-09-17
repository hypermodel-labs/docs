# API Examples

This directory contains example code for using the PDF Extraction and Data Query APIs.

## Prerequisites

1. Install dependencies:
```bash
npm install axios
```

2. Set up environment variables in your `.env` file:
```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
CLAY_API_KEY=clay_...
```

3. Start the server:
```bash
npm run build
npm start
```

## Examples

### PDF Extraction

The `pdf-extraction.js` file demonstrates:
- Extracting company information from PDFs
- Extracting financial data from quarterly reports
- Sending extracted data directly to Clay

Run with:
```bash
node examples/pdf-extraction.js
```

### Data Query

The `data-query.js` file demonstrates:
- Querying for Series A companies and exporting to Clay
- Finding B2B SaaS companies and exporting to Google Sheets
- Searching for fintech startups and sending to a webhook
- Checking job status and waiting for completion

Run with:
```bash
node examples/data-query.js
```

## cURL Examples

### PDF Extraction
```bash
curl -X POST http://localhost:3001/api/v1/pdf/extract \
  -H "Content-Type: application/json" \
  -d '{
    "pdfUrl": "https://example.com/document.pdf",
    "schema": {
      "company_name": "string",
      "revenue": "number"
    }
  }'
```

### Data Query
```bash
curl -X POST http://localhost:3001/api/v1/data/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Find Series A companies",
    "columns": ["name", "domain", "funding"],
    "destination": {
      "type": "clay",
      "config": {
        "tableId": "tbl_123"
      }
    }
  }'
```

### Check Job Status
```bash
curl http://localhost:3001/api/v1/data/query/{jobId}/status
```

## Python Examples

### PDF Extraction
```python
import requests

response = requests.post(
    'http://localhost:3001/api/v1/pdf/extract',
    json={
        'pdfUrl': 'https://example.com/document.pdf',
        'schema': {
            'company_name': 'string',
            'revenue': 'number'
        }
    }
)
print(response.json())
```

### Data Query
```python
import requests
import time

# Create job
response = requests.post(
    'http://localhost:3001/api/v1/data/query',
    json={
        'query': 'Find Series A companies',
        'columns': ['name', 'domain'],
        'destination': {
            'type': 'clay',
            'config': {'tableId': 'tbl_123'}
        }
    }
)
job_id = response.json()['jobId']

# Check status
while True:
    status = requests.get(f'http://localhost:3001/api/v1/data/query/{job_id}/status')
    data = status.json()
    if data['status'] in ['completed', 'failed']:
        print(data)
        break
    time.sleep(2)
```

## Integration with Clay

To integrate with Clay:

1. Get your Clay API key from Clay settings
2. Set `CLAY_API_KEY` in your environment
3. Use the Clay destination type in your queries
4. For PDF extraction, use the `/api/v1/pdf/extract/clay` endpoint