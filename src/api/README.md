# Query API

A natural language query API that processes business dataset requests and delivers enriched data to various destinations.

## Features

- **Natural Language Processing**: Uses Claude AI to parse and understand complex data queries
- **Data Extraction & Enrichment**: Automatically extracts and enriches data based on query requirements
- **Multiple Destinations**: Supports URL webhooks, Snowflake, Google Sheets, and Clay
- **Async Processing**: Uses Temporal workflows for reliable async processing
- **RESTful API**: Simple HTTP endpoints for query submission and status tracking

## API Endpoints

### Health Check
```
GET /api/health
```
Returns the health status of the Query API service.

### Create Query
```
POST /api/query
```
Submit a new query for processing.

**Request Body:**
```json
{
  "query": "Give me the top 10 Series A companies that sell to the hospitality industry",
  "destination": {
    "type": "URL|Snowflake|Sheets|Clay",
    "config": {
      // Destination-specific configuration
    }
  },
  "columns": ["name", "domain", "ceo_linkedin", "ceo_phone_number"]
}
```

**Response (202 Accepted):**
```json
{
  "id": "query_1234567890_abc123",
  "status": "pending",
  "destination": {
    "type": "URL"
  },
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

### Get Query Status
```
GET /api/query/:id
```
Retrieve the status and results of a specific query.

**Response:**
```json
{
  "id": "query_1234567890_abc123",
  "status": "completed|processing|failed",
  "destination": {
    "type": "URL",
    "url": "https://example.com/webhook"
  },
  "error": null,
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-01T00:01:00Z"
}
```

### List Queries
```
GET /api/queries
```
List all queries with their current status.

**Response:**
```json
{
  "queries": [
    {
      "id": "query_1234567890_abc123",
      "status": "completed",
      "destination": { "type": "URL" },
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 1
}
```

## Destination Configurations

### URL Destination
```json
{
  "type": "URL",
  "config": {
    "endpoint": "https://webhook.site/unique-id",
    "headers": {
      "X-API-Key": "your-api-key"
    }
  }
}
```

### Snowflake Destination
```json
{
  "type": "Snowflake",
  "config": {
    "account": "your-account",
    "database": "your-database",
    "schema": "your-schema",
    "table": "your-table",
    "warehouse": "your-warehouse",
    "username": "your-username",
    "password": "your-password"
  }
}
```

### Google Sheets Destination
```json
{
  "type": "Sheets",
  "config": {
    "spreadsheetId": "your-spreadsheet-id",
    "sheetName": "Sheet1",
    "accessToken": "google-oauth-access-token"
  }
}
```

### Clay Destination
```json
{
  "type": "Clay",
  "config": {
    "apiKey": "your-clay-api-key",
    "tableId": "your-table-id"
  }
}
```

## Architecture

### Components

1. **Query Planner** (`query-planner.ts`)
   - Parses natural language queries using Claude AI
   - Generates extraction and enrichment plans
   - Identifies required data columns and filters

2. **Data Extractor** (`data-extractor.ts`)
   - Executes data extraction based on query plan
   - Enriches data with additional information
   - Applies filters, sorting, and column selection

3. **Destination Handlers** (`destinations/`)
   - URL: Sends data via HTTP POST
   - Snowflake: Inserts data into Snowflake tables
   - Sheets: Appends data to Google Sheets
   - Clay: Sends data to Clay tables

4. **Temporal Workflows** (`temporal/`)
   - Manages async processing of queries
   - Provides reliability and retry mechanisms
   - Tracks query status throughout processing

5. **API Routes** (`routes.ts`)
   - RESTful endpoints for query management
   - Request validation using Zod schemas
   - Status tracking and query listing

## Environment Variables

```env
# Claude AI API Key
ANTHROPIC_API_KEY=your-anthropic-api-key

# Temporal Configuration (optional)
TEMPORAL_NAMESPACE=default

# Server Port
PORT=3001
```

## Testing

Run the test suite:
```bash
npm run test:mcp
npx tsx test_query_api.ts
```

## Usage Example

```javascript
import axios from 'axios';

const API_BASE = 'http://localhost:3001/api';

// Submit a query
const response = await axios.post(`${API_BASE}/query`, {
  query: 'Find 10 Series A fintech companies with CEO contact info',
  destination: {
    type: 'URL',
    config: {
      endpoint: 'https://my-webhook.com/receive',
    },
  },
  columns: ['name', 'domain', 'ceo_name', 'ceo_email', 'ceo_linkedin'],
});

const queryId = response.data.id;

// Check status
const status = await axios.get(`${API_BASE}/query/${queryId}`);
console.log('Query status:', status.data.status);
```

## Future Enhancements

- Real data source integration (databases, APIs)
- Advanced enrichment providers (Clearbit, Hunter.io, etc.)
- Batch query processing
- Query result caching
- Authentication and rate limiting
- WebSocket support for real-time updates
- Query templates and saved searches
- Data transformation pipelines
- Export formats (CSV, Excel, JSON)