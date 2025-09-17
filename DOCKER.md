# Docker Setup for PDF Extraction API

## Quick Start

### Using Docker Compose (Recommended)

1. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env and add your Google API key
```

2. **Build and run:**
```bash
docker-compose -f docker-compose.api.yml up --build
```

The API will be available at `http://localhost:3000`

3. **Run in background:**
```bash
docker-compose -f docker-compose.api.yml up -d
```

4. **Stop the service:**
```bash
docker-compose -f docker-compose.api.yml down
```

### Using Docker Directly

1. **Build the image:**
```bash
docker build -f Dockerfile.api -t pdf-extraction-api .
```

2. **Run the container:**
```bash
docker run -d \
  --name pdf-api \
  -p 3000:3000 \
  -e GOOGLE_API_KEY=your-api-key \
  pdf-extraction-api
```

3. **Check logs:**
```bash
docker logs pdf-api
```

4. **Stop and remove:**
```bash
docker stop pdf-api
docker rm pdf-api
```

## Environment Variables

The following environment variables should be set:

- `GOOGLE_API_KEY` or `GOOGLE_GENERATIVE_AI_API_KEY` - Your Google AI API key (required)
- `API_PORT` - Port to run the API on (default: 3000)
- `NODE_ENV` - Environment mode (default: production)

## Health Check

The container includes a health check that pings the `/health` endpoint every 30 seconds.

Check container health status:
```bash
docker ps
docker inspect pdf-api --format='{{.State.Health.Status}}'
```

## Building for Production

For production deployment:

```bash
# Build with specific tag
docker build -f Dockerfile.api -t pdf-extraction-api:v1.0.0 .

# Push to registry
docker tag pdf-extraction-api:v1.0.0 your-registry/pdf-extraction-api:v1.0.0
docker push your-registry/pdf-extraction-api:v1.0.0
```

## Troubleshooting

### Container won't start
- Check logs: `docker logs pdf-api`
- Verify environment variables are set correctly
- Ensure port 3000 is not already in use

### API key errors
- Ensure `GOOGLE_API_KEY` is set in environment or .env file
- Verify the API key is valid and has the necessary permissions

### Memory issues
- The Alpine Linux image is lightweight (~150MB)
- If processing large PDFs, consider increasing Docker memory limits

## Security Notes

- The container runs as a non-root user (nodejs:1001) for security
- Only port 3000 is exposed
- Environment variables should be managed securely in production
- Consider using Docker secrets for sensitive data in production

## Performance

The Docker image is optimized for production:
- Multi-stage build reduces final image size
- Alpine Linux base for minimal footprint
- Production dependencies only in final image
- Health check ensures availability monitoring