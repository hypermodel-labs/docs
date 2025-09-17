# API Documentation

## Overview

This API provides two main services:
1. **PDF Extraction API** - Extract structured data from PDFs using AI
2. **Data Query API** - Query, enrich, and export data using natural language

## Base URL

```
http://localhost:3001/api/v1
```

## Authentication

For protected endpoints, include your API key in the Authorization header:

```
Authorization: Bearer YOUR_API_KEY
```

## Endpoints

### 1. PDF Extraction

#### Extract data from PDF

**Endpoint:** `POST /api/v1/pdf/extract`

**Request Body:**
```json
{
  "pdfUrl": "https://example.com/document.pdf",
  "schema": {
    "company_name": "string",
    "founded_year": "number",
    "ceo_name": "string",
    "revenue": "number",
    "employees": "number",
    "industry": "string",
    "products": ["string"],
    "contact": {
      "email": "string",
      "phone": "string",
      "address": "string"
    }
  },
  "options": {
    "chunkSize": 2000,
    "overlap": 200,
    "maxChunks": 20
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "company_name": "TechCorp Inc",
    "founded_year": 2015,
    "ceo_name": "John Doe",
    "revenue": 10000000,
    "employees": 150,
    "industry": "Technology",
    "products": ["Software", "Consulting"],
    "contact": {
      "email": "info@techcorp.com",
      "phone": "+1-555-0123",
      "address": "123 Tech St, San Francisco, CA"
    }
  },
  "metadata": {
    "pdfUrl": "https://example.com/document.pdf",
    "totalPages": 15,
    "chunksProcessed": 8,
    "extractionTime": 3450
  }
}
```

#### Extract to Clay

**Endpoint:** `POST /api/v1/pdf/extract/clay`

Sends extracted data directly to Clay for further processing.

**Request Body:** Same as PDF extraction endpoint

**Additional Headers:**
- `X-Clay-Request-ID`: Unique request identifier from Clay

**Response:**
```json
{
  "success": true,
  "message": "Data sent to Clay",
  "request_id": "clay_12345"
}
```

### 2. Data Query API

#### Create data query job

**Endpoint:** `POST /api/v1/data/query`

**Request Body:**
```json
{
  "query": "Find top 10 Series A companies that sell to the hospitality industry",
  "columns": [
    "name",
    "domain",
    "ceo_linkedin",
    "ceo_phone_number",
    "funding_amount",
    "industry"
  ],
  "destination": {
    "type": "clay",
    "config": {
      "tableId": "table_xyz",
      "apiKey": "optional_override_key"
    }
  },
  "options": {
    "maxRows": 100,
    "enrichmentLevel": "advanced",
    "parallel": true
  }
}
```

**Destination Types:**
- `url` - Send to webhook URL
- `snowflake` - Export to Snowflake table
- `sheets` - Export to Google Sheets
- `clay` - Export to Clay table

**Enrichment Levels:**
- `basic` - Minimal enrichment
- `standard` - Moderate enrichment (default)
- `advanced` - Maximum enrichment with AI assistance

**Response:**
```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Query job has been submitted for processing",
  "destination": {
    "type": "clay",
    "config": {
      "tableId": "table_xyz"
    }
  }
}
```

#### Check job status

**Endpoint:** `GET /api/v1/data/query/:jobId/status`

**Response:**
```json
{
  "success": true,
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "createdAt": 1700000000000,
  "updatedAt": 1700000060000,
  "metadata": {
    "data": [...],
    "exportedAt": 1700000060000
  }
}
```

**Status Values:**
- `pending` - Job is queued
- `processing` - Job is being processed
- `completed` - Job completed successfully
- `failed` - Job failed

### 3. Health Check

**Endpoint:** `GET /api/v1/health`

**Response:**
```json
{
  "status": "healthy",
  "timestamp": 1700000000000,
  "services": {
    "pdfExtraction": "active",
    "dataQuery": "active"
  }
}
```

## Environment Variables

Configure these environment variables:

```bash
# Required
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Optional - for Clay integration
CLAY_API_KEY=clay_...
CLAY_WEBHOOK_URL=https://api.clay.com/webhook

# Optional - for enrichment
CLEARBIT_API_KEY=sk_...

# Server
PORT=3001
```

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message",
  "details": [...]
}
```

## Rate Limits

- PDF Extraction: 10 requests per minute
- Data Query: 5 concurrent jobs per account
- API calls are subject to underlying service limits (OpenAI, Anthropic)

## Examples

See the `examples/` directory for sample requests and integration code.