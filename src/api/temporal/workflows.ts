import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';
import { QueryRequest, QueryResponse } from '../types';

const { processQueryActivity, sendToDestinationActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    initialInterval: '1 second',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export async function queryProcessingWorkflow(request: QueryRequest): Promise<QueryResponse> {
  const queryId = `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    // Process the query and extract/enrich data
    const enrichedData = await processQueryActivity(request.query, request.columns);
    
    // Send data to the specified destination
    const destinationResult = await sendToDestinationActivity(
      enrichedData,
      request.destination
    );
    
    return {
      id: queryId,
      status: destinationResult.success ? 'completed' : 'failed',
      destination: {
        type: request.destination.type,
        url: destinationResult.url,
      },
      error: destinationResult.error,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  } catch (error) {
    return {
      id: queryId,
      status: 'failed',
      destination: {
        type: request.destination.type,
      },
      error: error instanceof Error ? error.message : 'Workflow execution failed',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}