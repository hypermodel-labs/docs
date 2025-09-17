import { Router, Request, Response } from 'express';
import { QueryExecutor } from './executor';
import { DataQueryRequestSchema } from './types';
import { z } from 'zod';

export function createDataQueryRouter(): Router {
  const router = Router();
  const executor = new QueryExecutor();

  router.post('/query', async (req: Request, res: Response) => {
    try {
      const validatedRequest = DataQueryRequestSchema.parse(req.body);

      const jobId = await executor.executeQuery(validatedRequest);

      res.json({
        success: true,
        jobId,
        status: 'pending',
        message: 'Query job has been submitted for processing',
        destination: validatedRequest.destination,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          details: error.errors,
        });
      }

      console.error('Data query error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process query',
      });
    }
  });

  router.get('/query/:jobId/status', async (req: Request, res: Response) => {
    try {
      const { jobId } = req.params;
      const jobStatus = executor.getJobStatus(jobId);

      if (!jobStatus) {
        return res.status(404).json({
          success: false,
          error: 'Job not found',
        });
      }

      res.json({
        success: true,
        jobId,
        status: jobStatus.status,
        createdAt: jobStatus.createdAt,
        updatedAt: jobStatus.updatedAt,
        metadata: jobStatus.metadata,
      });
    } catch (error) {
      console.error('Status check error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get job status',
      });
    }
  });

  return router;
}