import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client as PgClient } from 'pg';
import { createTemporalClient } from './temporal/client';
import { deriveIndexNameFromUrl } from './deriveIndexName';
import { indexDocumentationWorkflow, indexPdfWorkflow } from './temporal/workflows';
import {
  getUserContext,
  linkSession,
  hasAccess,
  getAccessibleIndexes,
  grantAccess,
  getSessionId,
  createIndexingJob,
  getIndexingJob,
  getIndexingJobs,
  ScopeType,
  AccessLevel,
} from './scope';
import { getEmbeddingConfig } from './settings';
import { createEmbeddingProvider, EmbeddingProvider } from './embeddings/providers';

async function createEmbeddingProviderInstance(): Promise<EmbeddingProvider> {
  const config = getEmbeddingConfig();

  if (!config.apiKey) {
    throw new Error(`${config.provider.toUpperCase()}_API_KEY not set`);
  }

  console.warn(
    `Using ${config.provider} embedding provider with model ${config.model} and ${config.dimensions} dimensions`
  );

  return createEmbeddingProvider(config.provider, config.apiKey, config.model, config.dimensions);
}

export function createDocsTool(server: McpServer) {
  // Create a tool to link to a user or team
  server.tool(
    'link',
    'Link to a user or team to set your scope context',
    {
      identifier: z.string().describe('User ID or team ID to link to'),
      scope: z
        .enum(['user', 'team'])
        .optional()
        .default('user')
        .describe('Scope type: user or team'),
    },
    async ({ identifier, scope }, { authInfo }) => {
      console.warn('[authInfo]', authInfo);
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }

      const client = new PgClient({ connectionString });
      try {
        await client.connect();
        const sessionId = getSessionId();

        await linkSession(client, sessionId, identifier, scope as ScopeType);

        return {
          content: [
            {
              type: 'text',
              text: `Successfully linked to ${scope}: ${identifier}. All documentation operations will now use this ${scope} scope.`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Failed to link to ${scope}: ${message}` }] };
      } finally {
        await client.end();
      }
    }
  );
  // Create a tool to search for documentation
  server.tool(
    'search-docs',
    'Use this tool to search vectorized documentation by index name. Requires DB and OpenAI to be configured. ALWAYS USE THE LIST-INDEXES TOOL TO GET THE INDEX NAME FIRST.',
    {
      index: z.string().describe('The vector DB index to search.'),
      query: z.string().describe('The semantic query'),
      topK: z.number().optional().default(10),
    },
    async ({ index, query, topK }) => {
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }

      const client = new PgClient({ connectionString });
      try {
        await client.connect();

        // Check access permissions
        let context;
        try {
          context = await getUserContext(client);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: message }] };
        }
        const hasReadAccess = await hasAccess(client, context, index, 'read');

        if (!hasReadAccess) {
          return {
            content: [
              {
                type: 'text',
                text: `Access denied: You don't have permission to search index "${index}". Current scope: ${context.scope} (${context.userId || context.teamId})`,
              },
            ],
          };
        }

        const table = `docs_${index}`;
        const quotedTable = `"${table}"`;

        // Generate embedding using the configured provider
        const embeddingProvider = await createEmbeddingProviderInstance();
        const [embedding] = await embeddingProvider.embedBatch([query]);
        const vectorParam = `[${embedding.join(',')}]`;
        // Query by cosine distance
        const { rows } = await client.query<{
          url: string;
          title: string;
          content: string;
          score: number;
        }>(
          `SELECT url, title, content, 1 - (embedding <=> $1::vector) AS score
           FROM ${quotedTable}
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          [vectorParam, topK]
        );
        const results = rows.map(
          (r: { url: string; title: string; content: string; score: number }) => ({
            url: r.url as string,
            title: r.title as string,
            snippet: (r.content as string).slice(0, 500),
            score: Number(r.score),
          })
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { index, total: results.length, results, scope: context.scope },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Search failed: ${message}` }] };
      } finally {
        await client.end();
      }
    }
  );

  // Create a tool to list all the indexes that have been created
  server.tool(
    'list-docs',
    'List available documentation indexes / docs / documentation discovered in the database.',
    {},
    async () => {
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }
      const client = new PgClient({ connectionString });
      try {
        await client.connect();

        // Get user context and accessible indexes
        let context;
        try {
          context = await getUserContext(client);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: message }] };
        }
        const accessibleIndexes = await getAccessibleIndexes(client, context);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  indexes: accessibleIndexes,
                  scope: context.scope,
                  linkedTo: context.userId || context.teamId,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Failed to list indexes: ${message}` }] };
      } finally {
        await client.end();
      }
    }
  );
  // Create a tool to index documentation from a public URL using Temporal
  server.tool(
    'index',
    'Index documentation from a public URL. Crawls the site or PDF URL and embeds content into a vector DB using Temporal Cloud for background processing. ALWAYS USE THE LIST-INDEXES TOOL TO CHECK IF AN INDEX WITH THE NAME ALREADY EXISTS.',
    {
      url: z.string().describe('The URL to index documentation or PDF from'),
      type: z.enum(['url', 'pdf']).describe('The type of content to index'),
      shareWith: z
        .array(z.string())
        .optional()
        .describe('Optional list of user/team IDs to share access with'),
      accessLevel: z
        .enum(['read', 'write', 'admin'])
        .optional()
        .default('read')
        .describe('Access level to grant'),
    },
    async ({ url, type, shareWith, accessLevel }) => {
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }

      const client = new PgClient({ connectionString });
      try {
        await client.connect();

        // Get user context
        let context;
        try {
          context = await getUserContext(client);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: message }] };
        }
        const indexName = deriveIndexNameFromUrl(url);

        // Create database record first
        const workflowId = `index-${indexName}-${Date.now()}`;
        await createIndexingJob(client, workflowId, indexName, url, context);

        // Start the indexing workflow
        const temporalClient = await createTemporalClient();
        const handle = await temporalClient.workflow.start(
          type === 'url' ? indexDocumentationWorkflow : indexPdfWorkflow,
          {
            args: [url, workflowId],
            taskQueue: 'docs-indexing',
            workflowId,
            workflowRunTimeout: '1 hour',
            workflowExecutionTimeout: '1 hour',
          }
        );

        // Grant access to the user who initiated the indexing
        const grantedBy = context.userId || context.teamId || 'system';
        if (context.userId && context.scope === 'user') {
          await grantAccess(client, context.userId, null, 'user', indexName, 'admin', grantedBy);
        } else if (context.teamId && context.scope === 'team') {
          await grantAccess(client, null, context.teamId, 'team', indexName, 'admin', grantedBy);
        }

        // Share with additional users/teams if specified
        if (shareWith && shareWith.length > 0) {
          for (const identifier of shareWith) {
            // Assume user scope for sharing unless it starts with 'team:'
            const isTeam = identifier.startsWith('team:');
            const cleanId = isTeam ? identifier.replace('team:', '') : identifier;
            const shareScope = isTeam ? 'team' : 'user';

            await grantAccess(
              client,
              isTeam ? null : cleanId,
              isTeam ? cleanId : null,
              shareScope as ScopeType,
              indexName,
              accessLevel as AccessLevel,
              grantedBy
            );
          }
        }

        const output = `Started indexing documentation from ${url} into index "${indexName}". Workflow ID: ${handle.workflowId}\nAccess granted to: ${context.scope} ${grantedBy}${shareWith ? ` and ${shareWith.join(', ')}` : ''}\nUse 'index-status ${handle.workflowId}' to check progress.`;
        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return {
          content: [{ type: 'text', text: `Failed to start indexing workflow: ${message}` }],
        };
      } finally {
        await client.end();
      }
    }
  );

  // Create a tool to check the status of an indexing job
  server.tool(
    'index-status',
    'Check the status of a documentation indexing job by workflow ID.',
    {
      workflowId: z.string().describe('The workflow ID of the indexing job'),
    },
    async ({ workflowId }) => {
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }

      const client = new PgClient({ connectionString });
      try {
        await client.connect();

        // Get job from database first
        const job = await getIndexingJob(client, workflowId);
        if (!job) {
          return {
            content: [{ type: 'text', text: `No indexing job found with ID: ${workflowId}` }],
          };
        }

        // Build status output
        let output = `Indexing Job Status: ${job.status.toUpperCase()}\n`;
        output += `Index: ${job.indexName}\n`;
        output += `Source URL: ${job.sourceUrl}\n`;
        output += `Started: ${job.startedAt.toISOString()}\n`;

        if (job.completedAt) {
          output += `Completed: ${job.completedAt.toISOString()}\n`;
          if (job.durationSeconds) {
            output += `Duration: ${Math.round(job.durationSeconds / 60)} minutes\n`;
          }
        }

        // Progress information
        output += `\nProgress:\n`;
        output += `- Pages Discovered: ${job.pagesDiscovered}\n`;
        output += `- Pages Processed: ${job.pagesProcessed}\n`;
        output += `- Pages Indexed: ${job.pagesIndexed}\n`;
        output += `- Total Chunks: ${job.totalChunks}\n`;

        // Error information if failed
        if (job.status === 'failed' && job.errorMessage) {
          output += `\nError: ${job.errorMessage}\n`;
        }

        // Try to get additional status from Temporal if job is still running
        if (job.status === 'running' || job.status === 'started') {
          try {
            const temporalClient = await createTemporalClient();
            const handle = temporalClient.workflow.getHandle(workflowId);
            const description = await handle.describe();
            output += `\nTemporal Status: ${description.status.name}\n`;
          } catch {
            // Ignore temporal errors, database status is primary
          }
        }

        return { content: [{ type: 'text', text: output }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Failed to get job status: ${message}` }] };
      } finally {
        await client.end();
      }
    }
  );

  // Create a tool to list indexing jobs for the current user/team
  server.tool(
    'list-indexing-jobs',
    'List recent indexing jobs for your current user/team scope.',
    {
      limit: z.number().optional().default(10).describe('Number of jobs to return (max 50)'),
    },
    async ({ limit }) => {
      const connectionString = process.env.POSTGRES_CONNECTION_STRING;
      if (!connectionString) {
        return { content: [{ type: 'text', text: 'Error: POSTGRES_CONNECTION_STRING not set' }] };
      }

      const client = new PgClient({ connectionString });
      try {
        await client.connect();

        let context;
        try {
          context = await getUserContext(client);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: [{ type: 'text', text: message }] };
        }
        const jobs = await getIndexingJobs(client, context, Math.min(limit, 50));

        if (jobs.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: `No indexing jobs found for ${context.scope}: ${context.userId || context.teamId}`,
              },
            ],
          };
        }

        const jobsList = jobs.map(job => ({
          jobId: job.jobId,
          indexName: job.indexName,
          sourceUrl: job.sourceUrl,
          status: job.status,
          startedAt: job.startedAt.toISOString(),
          completedAt: job.completedAt?.toISOString() || null,
          pagesIndexed: job.pagesIndexed,
          totalChunks: job.totalChunks,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  scope: context.scope,
                  linkedTo: context.userId || context.teamId,
                  total: jobs.length,
                  jobs: jobsList,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(err);
        return { content: [{ type: 'text', text: `Failed to list indexing jobs: ${message}` }] };
      } finally {
        await client.end();
      }
    }
  );

  // Create a tool to check current embedding configuration
  server.tool(
    'embedding-config',
    'Check the current embedding provider configuration and settings.',
    {},
    async () => {
      try {
        const config = getEmbeddingConfig();
        const hasApiKey = !!config.apiKey;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  provider: config.provider,
                  model: config.model,
                  dimensions: config.dimensions,
                  apiKeyConfigured: hasApiKey,
                  environmentVariables: {
                    EMBEDDING_PROVIDER:
                      process.env.EMBEDDING_PROVIDER || 'not set (defaults to openai)',
                    [`${config.provider.toUpperCase()}_API_KEY`]: hasApiKey
                      ? 'configured'
                      : 'not set',
                    [`${config.provider.toUpperCase()}_EMBEDDING_MODEL`]:
                      process.env[`${config.provider.toUpperCase()}_EMBEDDING_MODEL`] ||
                      'using default',
                    [`${config.provider.toUpperCase()}_EMBEDDING_DIMENSIONS`]:
                      process.env[`${config.provider.toUpperCase()}_EMBEDDING_DIMENSIONS`] ||
                      'using default',
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text', text: `Failed to get embedding config: ${message}` }] };
      }
    }
  );
}
