import { Express, Router } from 'express';
import { createPDFExtractionRouter } from './pdf-extraction/router';
import { createDataQueryRouter } from './data-query/router';

export interface APIModule {
  install: (app: Express) => void;
}

export function createAPIModule(): APIModule {
  const apiRouter = Router();

  const pdfRouter = createPDFExtractionRouter();
  const queryRouter = createDataQueryRouter();

  apiRouter.use('/pdf', pdfRouter);
  apiRouter.use('/data', queryRouter);

  apiRouter.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: Date.now(),
      services: {
        pdfExtraction: 'active',
        dataQuery: 'active',
      },
    });
  });

  return {
    install: (app: Express) => {
      app.use('/api/v1', apiRouter);

      console.error('API endpoints registered:');
      console.error('  PDF Extraction: POST /api/v1/pdf/extract');
      console.error('  PDF Clay Integration: POST /api/v1/pdf/extract/clay');
      console.error('  Data Query: POST /api/v1/data/query');
      console.error('  Query Status: GET /api/v1/data/query/:jobId/status');
      console.error('  Health Check: GET /api/v1/health');
    },
  };
}