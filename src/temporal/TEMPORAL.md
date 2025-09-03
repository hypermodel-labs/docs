# Temporal Cloud Integration

This MCP server uses Temporal Cloud for background processing of documentation indexing jobs.

## Setup

### 1. Temporal Cloud Configuration

1. Create a Temporal Cloud account at https://cloud.temporal.io/
2. Create a new namespace
3. Generate client certificates for your namespace
4. Configure your environment variables:

```bash
# Your Temporal Cloud namespace address
TEMPORAL_ADDRESS=your-namespace.a2dd6.tmprl.cloud:7233

# Your Temporal Cloud namespace
TEMPORAL_NAMESPACE=your-namespace

# Base64-encoded TLS certificate
TEMPORAL_TLS_CERT=your-base64-encoded-cert

# Base64-encoded TLS private key
TEMPORAL_TLS_KEY=your-base64-encoded-key
```

### 2. Running the Worker

The Temporal worker needs to be running to process indexing jobs:

```bash
npm run build
npm run worker
```

### 3. Using the Tools

The indexing is now asynchronous:

1. Start an indexing job:

   ```
   Use the "index" tool with a URL
   ```

2. Check job status:
   ```
   Use the "index-status" tool with the returned workflow ID
   ```

## Architecture

- **Workflows** (`src/temporal/workflows.ts`): Define the indexing workflow
- **Activities** (`src/temporal/activities.ts`): Contain the actual indexing logic
- **Client** (`src/temporal/client.ts`): Temporal client configuration
- **Worker** (`src/temporal/worker.ts`): Processes workflows and activities

## Benefits

- **Reliability**: Jobs are automatically retried on failure
- **Scalability**: Multiple workers can process jobs in parallel
- **Observability**: Track job progress through Temporal Web UI
- **Durability**: Jobs survive server restarts
