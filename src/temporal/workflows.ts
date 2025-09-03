import { proxyActivities } from '@temporalio/workflow';
import type * as activities from './activities';

const { indexDocumentationActivity, indexPdfActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '3 hour',
  retry: {
    maximumAttempts: 3,
  },
  heartbeatTimeout: '3 hour',
});

export async function indexDocumentationWorkflow(
  startUrl: string,
  jobId: string
): Promise<{ indexName: string; pagesIndexed: number; totalChunks: number }> {
  return await indexDocumentationActivity(startUrl, jobId);
}

export async function indexPdfWorkflow(
  pdfUrl: string,
  jobId: string
): Promise<{ indexName: string; pagesIndexed: number; totalChunks: number }> {
  return await indexPdfActivity(pdfUrl, jobId);
}
