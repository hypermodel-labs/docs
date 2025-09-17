import { Router, Request, Response } from 'express';
import { PDFExtractor } from './extractor';
import { PDFExtractionRequestSchema } from './types';
import { z } from 'zod';

export function createPDFExtractionRouter(): Router {
  const router = Router();
  const extractor = new PDFExtractor();

  router.post('/extract', async (req: Request, res: Response) => {
    try {
      const validatedRequest = PDFExtractionRequestSchema.parse(req.body);

      const result = await extractor.extractFromURL(validatedRequest);

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          details: error.errors,
        });
      }

      console.error('PDF extraction error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to extract PDF data',
      });
    }
  });

  router.post('/extract/clay', async (req: Request, res: Response) => {
    try {
      const clayWebhookUrl = process.env.CLAY_WEBHOOK_URL;
      if (!clayWebhookUrl) {
        throw new Error('Clay webhook URL not configured');
      }

      const validatedRequest = PDFExtractionRequestSchema.parse(req.body);
      const clayRequestId = req.headers['x-clay-request-id'] as string;

      const result = await extractor.extractFromURL(validatedRequest);

      const clayPayload = {
        request_id: clayRequestId,
        success: true,
        data: result.data,
        metadata: result.metadata,
      };

      const axios = (await import('axios')).default;
      await axios.post(clayWebhookUrl, clayPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Clay-API-Key': process.env.CLAY_API_KEY,
        },
      });

      res.json({
        success: true,
        message: 'Data sent to Clay',
        request_id: clayRequestId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Invalid request',
          details: error.errors,
        });
      }

      console.error('Clay integration error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process Clay request',
      });
    }
  });

  return router;
}