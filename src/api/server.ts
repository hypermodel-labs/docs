import express from 'express';
import dotenv from 'dotenv';
import pdfExtractionRouter from './pdf-extraction';

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
    console.log(`PDF Extraction API server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`API endpoint:`);
    console.log(`  POST http://localhost:${PORT}/api/v1/pdf/extract`);
  });
}

// Start server if this file is run directly
startServer();

export default app;
