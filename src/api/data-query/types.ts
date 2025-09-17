import { z } from 'zod';

export const DestinationType = z.enum(['url', 'snowflake', 'sheets', 'clay']);

export const DataQueryRequestSchema = z.object({
  query: z.string().min(1),
  columns: z.array(z.string()).min(1),
  destination: z.object({
    type: DestinationType,
    config: z.record(z.any()),
  }),
  options: z
    .object({
      maxRows: z.number().min(1).max(10000).default(100),
      enrichmentLevel: z.enum(['basic', 'standard', 'advanced']).default('standard'),
      parallel: z.boolean().default(true),
    })
    .optional(),
});

export type DataQueryRequest = z.infer<typeof DataQueryRequestSchema>;

export const DataQueryResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed']),
  message: z.string(),
  destination: z.object({
    type: DestinationType,
    location: z.string().optional(),
  }),
});

export type DataQueryResponse = z.infer<typeof DataQueryResponseSchema>;

export interface QueryPlan {
  steps: QueryStep[];
  estimatedTime: number;
  dataSource: string;
}

export interface QueryStep {
  type: 'search' | 'extract' | 'enrich' | 'transform' | 'export';
  description: string;
  tool?: string;
  parameters?: Record<string, any>;
}

export interface EnrichmentResult {
  originalData: Record<string, any>;
  enrichedData: Record<string, any>;
  metadata: {
    source: string;
    confidence: number;
    timestamp: number;
  };
}