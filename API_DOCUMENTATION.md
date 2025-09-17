# PDF Extraction API Documentation

## Overview
A simple API service for extracting structured information from PDF documents using Google's Gemini AI with URL context. The API processes PDFs directly from URLs without downloading them.

## Features
- **Direct URL Processing** - Uses Gemini's URL context tool to process PDFs without downloading
- **Schema-based extraction** - Define exactly what data you want to extract
- **Custom prompts** - Provide specific instructions for extraction
- **No file downloads** - PDFs are processed directly from URLs for better performance
- **RESTful API design**

## Installation

```bash
npm install --legacy-peer-deps
```

## Configuration

Create a `.env` file with the following variables:

```env
API_PORT=3000
GOOGLE_API_KEY=your-google-api-key
# OR
GOOGLE_GENERATIVE_AI_API_KEY=your-google-api-key
```

## Starting the Server

```bash
npm run build
node dist/api/server.js
```

## API Endpoints

### 1. Extract Data from PDF

**Endpoint:** `POST /api/v1/pdf/extract`

**Request Body:**
```json
{
  "pdfUrl": "https://example.com/document.pdf",
  "schema": {
    "companyName": "string",
    "invoiceNumber": "string",
    "date": "date",
    "totalAmount": "number",
    "lineItems": ["string"],
    "customer": {
      "name": "string",
      "email": "email",
      "address": "string"
    }
  },
  "prompt": "Optional custom extraction instructions"
}
```

**Parameters:**
- `pdfUrl` (required): URL of the PDF to process
- `schema` (required): JSON object defining the structure of data to extract
- `prompt` (optional): Custom instructions for the extraction

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://example.com/document.pdf",
    "extractedData": {
      "companyName": "Acme Corp",
      "invoiceNumber": "INV-2024-001",
      "date": "2024-01-15",
      "totalAmount": 1500.00,
      "lineItems": ["Product A", "Product B"],
      "customer": {
        "name": "John Doe",
        "email": "john@example.com",
        "address": "123 Main St"
      }
    },
    "urlContextMetadata": {
      // Gemini's URL context metadata
    },
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### 2. Health Check

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Schema Types

The following data types are supported in schemas:

- `string` - Text data
- `number` - Numeric values
- `boolean` - True/false values
- `date` - Date values
- `email` - Email addresses
- `url` - URLs
- Arrays - Use `["type"]` for arrays of values
- Objects - Nested structures with their own fields

## Custom Prompts

You can provide custom extraction prompts to give specific instructions:

```json
{
  "prompt": "Extract all franchisee information from Item 20 of this FDD. Focus on contact details and location data."
}
```

## Error Handling

The API returns standard HTTP status codes:

- `200 OK` - Successful extraction
- `400 Bad Request` - Invalid request parameters or schema
- `500 Internal Server Error` - Server error during processing

Error responses include:
```json
{
  "success": false,
  "error": "Error message describing the issue"
}
```

## Example Usage

### JavaScript/Node.js

```javascript
const response = await fetch('http://localhost:3000/api/v1/pdf/extract', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    pdfUrl: 'https://example.com/invoice.pdf',
    schema: {
      invoiceNumber: 'string',
      amount: 'number',
      date: 'date'
    },
    prompt: 'Extract invoice details'
  })
});

const result = await response.json();
console.log(result.data.extractedData);
```

### Python

```python
import requests

response = requests.post(
    'http://localhost:3000/api/v1/pdf/extract',
    json={
        'pdfUrl': 'https://example.com/invoice.pdf',
        'schema': {
            'invoiceNumber': 'string',
            'amount': 'number',
            'date': 'date'
        },
        'prompt': 'Extract invoice details'
    }
)

result = response.json()
print(result['data']['extractedData'])
```

### cURL

```bash
curl -X POST http://localhost:3000/api/v1/pdf/extract \
  -H "Content-Type: application/json" \
  -d '{
    "pdfUrl": "https://example.com/document.pdf",
    "schema": {
      "title": "string",
      "author": "string",
      "date": "date"
    }
  }'
```

## Running Examples

```bash
# Extract with custom prompt
node examples/extract-with-gemini.js https://example.com/document.pdf
```

## Key Advantages of URL Context

1. **No Download Required** - PDFs are processed directly from URLs
2. **Faster Processing** - No time spent downloading and parsing files
3. **Lower Memory Usage** - No need to store PDFs in memory
4. **Better for Large Files** - Can handle large PDFs efficiently
5. **Gemini Optimized** - Uses Gemini's native URL context capabilities

## Limitations

- Requires PDFs to be publicly accessible via URL
- Subject to Gemini API rate limits
- Maximum PDF size depends on Gemini's limits
- URLs must be valid and return proper PDF content

## Common Use Cases

1. **Invoice Processing** - Extract invoice numbers, dates, amounts, line items
2. **Resume Parsing** - Extract contact info, skills, experience
3. **Contract Analysis** - Extract parties, terms, dates, obligations
4. **Form Processing** - Extract form fields and values
5. **Report Mining** - Extract key metrics, findings, recommendations
6. **Franchise Documents** - Extract franchisee lists, contact information

## Troubleshooting

- **"API key not valid" error**: Make sure your Google API key is set in `.env`
- **Empty responses**: Check if the PDF URL is publicly accessible
- **Parsing errors**: Ensure your schema matches the PDF content structure
- **Rate limiting**: Consider implementing delays between multiple requests