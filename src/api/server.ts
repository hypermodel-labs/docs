import express from 'express';
import dotenv from 'dotenv';
import pdfExtractionRouter from './pdf-extraction';
import { createQueryAPIModule } from './index';

dotenv.config();

const app = express();
const PORT = process.env.API_PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

app.use('/api/v1/pdf', pdfExtractionRouter);

// Install Query API endpoints
const queryAPI = createQueryAPIModule();
app.use('/api/v1/query', queryAPI.router);

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: err.message,
  });
});

export function startServer() {
  app.listen(PORT, () => {
    console.log(`API server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Available API endpoints:`);
    console.log(`  PDF Extraction:`);
    console.log(`    POST http://localhost:${PORT}/api/v1/pdf/extract`);
    console.log(`  Query API:`);
    console.log(`    GET  http://localhost:${PORT}/api/v1/query/health`);
    console.log(`    POST http://localhost:${PORT}/api/v1/query/query`);
    console.log(`    GET  http://localhost:${PORT}/api/v1/query/query/:id`);
    console.log(`    GET  http://localhost:${PORT}/api/v1/query/queries`);
  });
}

// Start server if this file is run directly
startServer();

export default app;