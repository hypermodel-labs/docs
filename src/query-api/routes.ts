import { Request, Response, Router } from 'express';
import { Client } from '@temporalio/client';
import { queryProcessingWorkflow } from './temporal/workflows';
import { QueryRequest, QueryResponse } from './types';
import { z } from 'zod';

// Validation schemas
const queryRequestSchema = z.object({
  query: z.string().min(1),
  destination: z.object({
    type: z.enum(['URL', 'Snowflake', 'Sheets', 'Clay']),
    config: z.record(z.unknown()),
  }),
  columns: z.array(z.string()).optional(),
});

export class QueryAPIRouter {
  private router: Router;
  private temporalClient?: Client;
  private queries: Map<string, QueryResponse> = new Map();

  constructor() {
    this.router = Router();
    this.setupRoutes();
    this.initializeTemporalClient();
  }

  private async initializeTemporalClient() {
    try {
      this.temporalClient = new Client({
        namespace: process.env.TEMPORAL_NAMESPACE || 'default',
      });
    } catch (error) {
      console.error('Failed to initialize Temporal client:', error);
    }
  }

  private setupRoutes() {
    // Health check endpoint
    this.router.get('/health', this.healthCheck.bind(this));

    // Create a new query request
    this.router.post('/query', this.createQuery.bind(this));

    // Get query status
    this.router.get('/query/:id', this.getQueryStatus.bind(this));

    // List all queries
    this.router.get('/queries', this.listQueries.bind(this));
  }

  private async healthCheck(req: Request, res: Response): Promise<void> {
    res.json({
      status: 'healthy',
      service: 'query-api',
      temporal: this.temporalClient ? 'connected' : 'disconnected',
    });
  }

  private async createQuery(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const validation = queryRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request',
          details: validation.error.errors,
        });
        return;
      }

      const request = validation.data as QueryRequest;

      // Create initial response
      const queryId = `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const initialResponse: QueryResponse = {
        id: queryId,
        status: 'pending',
        destination: {
          type: request.destination.type,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store in memory (in production, use a database)
      this.queries.set(queryId, initialResponse);

      // Process asynchronously
      if (this.temporalClient) {
        // Use Temporal for async processing
        this.processWithTemporal(queryId, request);
      } else {
        // Fallback to direct processing
        this.processDirect(queryId, request);
      }

      res.status(202).json(initialResponse);
    } catch (error) {
      console.error('Error creating query:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async processWithTemporal(queryId: string, request: QueryRequest) {
    try {
      if (!this.temporalClient) {
        throw new Error('Temporal client not initialized');
      }

      const handle = await this.temporalClient.workflow.start(queryProcessingWorkflow, {
        taskQueue: 'query-processing',
        workflowId: queryId,
        args: [request],
      });

      const result = await handle.result();
      
      // Update stored query with result
      this.queries.set(queryId, result);
    } catch (error) {
      console.error(`Error processing query ${queryId} with Temporal:`, error);
      
      // Update query with error
      const query = this.queries.get(queryId);
      if (query) {
        query.status = 'failed';
        query.error = error instanceof Error ? error.message : 'Processing failed';
        query.updatedAt = new Date();
        this.queries.set(queryId, query);
      }
    }
  }

  private async processDirect(queryId: string, request: QueryRequest) {
    try {
      // Import activities directly for fallback processing
      const { processQueryActivity, sendToDestinationActivity } = await import('./temporal/activities');
      
      // Update status to processing
      const query = this.queries.get(queryId);
      if (query) {
        query.status = 'processing';
        query.updatedAt = new Date();
        this.queries.set(queryId, query);
      }

      // Process the query
      const enrichedData = await processQueryActivity(request.query, request.columns);
      
      // Send to destination
      const destinationResult = await sendToDestinationActivity(
        enrichedData,
        request.destination
      );

      // Update query with result
      if (query) {
        query.status = destinationResult.success ? 'completed' : 'failed';
        query.destination.url = destinationResult.url;
        query.error = destinationResult.error;
        query.updatedAt = new Date();
        this.queries.set(queryId, query);
      }
    } catch (error) {
      console.error(`Error processing query ${queryId} directly:`, error);
      
      // Update query with error
      const query = this.queries.get(queryId);
      if (query) {
        query.status = 'failed';
        query.error = error instanceof Error ? error.message : 'Processing failed';
        query.updatedAt = new Date();
        this.queries.set(queryId, query);
      }
    }
  }

  private async getQueryStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const query = this.queries.get(id);
      if (!query) {
        res.status(404).json({
          error: 'Query not found',
        });
        return;
      }

      res.json(query);
    } catch (error) {
      console.error('Error getting query status:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async listQueries(req: Request, res: Response): Promise<void> {
    try {
      const queries = Array.from(this.queries.values());
      
      // Sort by creation date (newest first)
      queries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      res.json({
        queries,
        total: queries.length,
      });
    } catch (error) {
      console.error('Error listing queries:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}