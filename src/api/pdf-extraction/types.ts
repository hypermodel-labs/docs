import { z } from 'zod';

export const PDFExtractionRequestSchema = z.object({
  pdfUrl: z.string().url(),
  schema: z.record(z.any()),
  options: z
    .object({
      chunkSize: z.number().min(100).max(10000).default(2000),
      overlap: z.number().min(0).max(500).default(200),
      maxChunks: z.number().min(1).max(100).default(20),
    })
    .optional(),
});

export type PDFExtractionRequest = z.infer<typeof PDFExtractionRequestSchema>;

export const PDFExtractionResponseSchema = z.object({
  data: z.record(z.any()),
  metadata: z.object({
    pdfUrl: z.string(),
    totalPages: z.number(),
    chunksProcessed: z.number(),
    extractionTime: z.number(),
  }),
});

export type PDFExtractionResponse = z.infer<typeof PDFExtractionResponseSchema>;

export interface PDFChunk {
  text: string;
  pageNumbers: number[];
  chunkIndex: number;
}