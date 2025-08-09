import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { indexDocumentationActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 minutes',
  retry: {
    maximumAttempts: 3,
  },
  heartbeatTimeout: '10 seconds',
});

export async function indexDocumentationWorkflow(startUrl: string): Promise<{ indexName: string }> {
  return await indexDocumentationActivity(startUrl);
}
