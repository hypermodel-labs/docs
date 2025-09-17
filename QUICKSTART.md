# PDF Extraction API - Quick Start Guide

## Prerequisites

- Node.js 18+ installed
- Google API key for Gemini models (REQUIRED)

## Setup

1. **Install dependencies:**
```bash
npm install --legacy-peer-deps
```

2. **Configure environment variables:**
```bash
cp .env.example .env
# Edit .env and add your Google API key:
# GOOGLE_API_KEY=your-google-api-key
# OR
# GOOGLE_GENERATIVE_AI_API_KEY=your-google-api-key
```

3. **Build the project:**
```bash
npm run build
```

4. **Start the API server:**
```bash
npm run start:api
# OR directly:
node dist/api/server.js
```

The server will start on `http://localhost:3000`

## Basic Usage

### Extract data from a PDF

```bash
curl -X POST http://localhost:3000/api/v1/pdf/extract \
  -H "Content-Type: application/json" \
  -d '{
    "pdfUrl": "https://example.com/invoice.pdf",
    "schema": {
      "invoiceNumber": "string",
      "date": "date",
      "total": "number",
      "items": ["string"]
    },
    "prompt": "Extract invoice details from this document"
  }'
```

## Key Features

- **Direct URL Processing** - Uses Gemini's URL context to process PDFs without downloading
- **Schema-based extraction** - Define exactly what data you want to extract
- **Custom prompts** - Provide specific extraction instructions
- **No file downloads** - PDFs processed directly from URLs for better performance

## Running Examples

```bash
# Extract with custom prompt
node examples/extract-with-gemini.js https://example.com/document.pdf
```

## API Documentation

For detailed API documentation, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)

## Testing

```bash
# Test health endpoint
curl http://localhost:3000/health
```

## How It Works

This API uses Google's Gemini AI with the URL context tool, which means:

1. PDFs are NOT downloaded to your server
2. Gemini directly accesses the PDF from its URL
3. Processing is faster and uses less memory
4. Large PDFs can be handled efficiently

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

## Support

For issues or questions, please check the [API documentation](./API_DOCUMENTATION.md) or open an issue in the repository.