import express from 'express';
import { z } from 'zod';
import { extractFromPDF } from '../services/pdf-processor';

const router = express.Router();

const extractionRequestSchema = z.object({
  pdfUrl: z.string().url(),
  schema: z.record(z.any()),
  prompt: z.string().optional(),
});

router.post('/extract', async (req: express.Request, res: express.Response) => {
  try {
    const validatedData = extractionRequestSchema.parse(req.body);

    const result = await extractFromPDF({
      pdfUrl: validatedData.pdfUrl,
      schema: validatedData.schema,
      prompt: validatedData.prompt,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('PDF extraction error:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
});

export default router;