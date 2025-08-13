import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { indexDocumentationActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '1 hour',
  retry: {
    maximumAttempts: 3,
  },
  heartbeatTimeout: '1 hour',
});

export async function indexDocumentationWorkflow(
  startUrl: string,
  jobId: string
): Promise<{ indexName: string; pagesIndexed: number; totalChunks: number }> {
  return await indexDocumentationActivity(startUrl, jobId);
}
