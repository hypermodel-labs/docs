import { Client as PgClient } from 'pg';
import crypto from 'node:crypto';

export type ScopeType = 'user' | 'team';
export type AccessLevel = 'read' | 'write' | 'admin';
export type IndexingStatus =
  | 'started'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export interface UserContext {
  sessionId: string;
  userId: string | null;
  teamId: string | null;
  scope: ScopeType;
}

export interface AccessPermission {
  userId: string | null;
  teamId: string | null;
  scope: ScopeType;
  indexName: string;
  accessLevel: AccessLevel;
  grantedBy: string | null;
  grantedAt: Date;
  expiresAt: Date | null;
}

export interface IndexingJob {
  id: number;
  jobId: string;
  indexName: string;
  sourceUrl: string;
  status: IndexingStatus;
  initiatedByUser: string | null;
  initiatedByTeam: string | null;
  scope: ScopeType;
  startedAt: Date;
  completedAt: Date | null;
  durationSeconds: number | null;
  pagesDiscovered: number;
  pagesProcessed: number;
  pagesIndexed: number;
  totalChunks: number;
  errorMessage: string | null;
  errorDetails: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

// Generate a unique session ID
export function generateSessionId(): string {
  return `session_${crypto.randomUUID()}`;
}

// Get session ID from MCP context or generate new one
export function getSessionId(): string {
  // In a real implementation, this would extract from MCP server context
  // For now, we'll use a simple approach with process environment
  if (!process.env.MCP_SESSION_ID) {
    process.env.MCP_SESSION_ID = generateSessionId();
  }
  return process.env.MCP_SESSION_ID;
}

// Get current user context from session
export async function getUserContext(client: PgClient, sessionId?: string): Promise<UserContext> {
  const sid = sessionId || getSessionId();

  try {
    const { rows } = await client.query(
      'SELECT user_id, team_id, scope FROM user_links WHERE session_id = $1',
      [sid]
    );

    if (rows.length > 0) {
      return {
        sessionId: sid,
        userId: rows[0].user_id,
        teamId: rows[0].team_id,
        scope: rows[0].scope as ScopeType,
      };
    }

    // Throw error if user is not linked
    throw new Error('User not linked. Please use the "link" tool to link to a user or team first.');
  } catch (error) {
    if (error instanceof Error && error.message.includes('User not linked')) {
      throw error; // Re-throw the "User not linked" error
    }
    console.error('Error getting user context:', error);
    throw new Error('User not linked. Please use the "link" tool to link to a user or team first.');
  }
}

// Link a session to a user or team
export async function linkSession(
  client: PgClient,
  sessionId: string,
  identifier: string,
  scope: ScopeType
): Promise<void> {
  const userId = scope === 'user' ? identifier : null;
  const teamId = scope === 'team' ? identifier : null;

  await client.query(
    `INSERT INTO user_links (session_id, user_id, team_id, scope) 
     VALUES ($1, $2, $3, $4) 
     ON CONFLICT (session_id) DO UPDATE SET 
       user_id = EXCLUDED.user_id,
       team_id = EXCLUDED.team_id,
       scope = EXCLUDED.scope,
       updated_at = now()`,
    [sessionId, userId, teamId, scope]
  );
}

// Check if user has access to a specific index
export async function hasAccess(
  client: PgClient,
  context: UserContext,
  indexName: string,
  requiredLevel: AccessLevel = 'read'
): Promise<boolean> {
  try {
    const accessLevels = { read: 1, write: 2, admin: 3 };
    const required = accessLevels[requiredLevel];

    // Check for specific user/team access
    let query = `
      SELECT access_level FROM doc_access 
      WHERE index_name = $1 
      AND (expires_at IS NULL OR expires_at > now())
      AND (
        (scope = 'user' AND user_id = $2) OR
        (scope = 'team' AND team_id = $3) OR
        (user_id IS NULL AND team_id IS NULL)  -- Universal access
      )
      ORDER BY 
        CASE access_level 
          WHEN 'admin' THEN 3 
          WHEN 'write' THEN 2 
          WHEN 'read' THEN 1 
        END DESC
      LIMIT 1`;

    const { rows } = await client.query(query, [indexName, context.userId, context.teamId]);

    if (rows.length === 0) {
      return false;
    }

    const userLevel = accessLevels[rows[0].access_level as AccessLevel];
    return userLevel >= required;
  } catch (error) {
    console.error('Error checking access:', error);
    return false;
  }
}

// Get all accessible indexes for a user
export async function getAccessibleIndexes(
  client: PgClient,
  context: UserContext
): Promise<string[]> {
  try {
    const { rows } = await client.query(
      `SELECT DISTINCT index_name FROM doc_access 
       WHERE (expires_at IS NULL OR expires_at > now())
       AND (
         (scope = 'user' AND user_id = $1) OR
         (scope = 'team' AND team_id = $2) OR
         (user_id IS NULL AND team_id IS NULL)  -- Universal access
       )
       ORDER BY index_name`,
      [context.userId, context.teamId]
    );

    return rows.map(r => r.index_name);
  } catch (error) {
    console.error('Error getting accessible indexes:', error);
    return [];
  }
}

// Grant access to an index
export async function grantAccess(
  client: PgClient,
  targetUserId: string | null,
  targetTeamId: string | null,
  scope: ScopeType,
  indexName: string,
  accessLevel: AccessLevel,
  grantedBy: string,
  expiresAt?: Date
): Promise<void> {
  await client.query(
    `INSERT INTO doc_access (user_id, team_id, scope, index_name, access_level, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, team_id, scope, index_name) DO UPDATE SET
       access_level = EXCLUDED.access_level,
       granted_by = EXCLUDED.granted_by,
       granted_at = now(),
       expires_at = EXCLUDED.expires_at`,
    [targetUserId, targetTeamId, scope, indexName, accessLevel, grantedBy, expiresAt]
  );
}

// Revoke access to an index
export async function revokeAccess(
  client: PgClient,
  targetUserId: string | null,
  targetTeamId: string | null,
  scope: ScopeType,
  indexName: string
): Promise<void> {
  await client.query(
    'DELETE FROM doc_access WHERE user_id = $1 AND team_id = $2 AND scope = $3 AND index_name = $4',
    [targetUserId, targetTeamId, scope, indexName]
  );
}

// Clean up expired sessions and permissions
export async function cleanupExpired(
  client: PgClient
): Promise<{ sessions: number; permissions: number }> {
  try {
    // Clean up old sessions (older than 30 days)
    const { rowCount: sessionsDeleted } = await client.query(
      "DELETE FROM user_links WHERE updated_at < now() - INTERVAL '30 days'"
    );

    // Clean up expired permissions
    const { rowCount: permissionsDeleted } = await client.query(
      'DELETE FROM doc_access WHERE expires_at IS NOT NULL AND expires_at < now()'
    );

    return {
      sessions: sessionsDeleted || 0,
      permissions: permissionsDeleted || 0,
    };
  } catch (error) {
    console.error('Error during cleanup:', error);
    return { sessions: 0, permissions: 0 };
  }
}

// Create a new indexing job record
export async function createIndexingJob(
  client: PgClient,
  jobId: string,
  indexName: string,
  sourceUrl: string,
  context: UserContext,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await client.query(
    `INSERT INTO indexing_jobs (job_id, index_name, source_url, initiated_by_user, initiated_by_team, scope, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      jobId,
      indexName,
      sourceUrl,
      context.userId,
      context.teamId,
      context.scope,
      JSON.stringify(metadata),
    ]
  );
}

// Update indexing job status
export async function updateIndexingJobStatus(
  client: PgClient,
  jobId: string,
  status: IndexingStatus,
  updates: {
    pagesDiscovered?: number;
    pagesProcessed?: number;
    pagesIndexed?: number;
    totalChunks?: number;
    errorMessage?: string;
    errorDetails?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const fields: string[] = ['status = $2'];
  const values: unknown[] = [jobId, status];
  let paramCount = 2;

  // Set completed_at and calculate duration for completed/failed status
  if (status === 'completed' || status === 'failed') {
    fields.push(`completed_at = now()`);
    fields.push(`duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))`);
  }

  if (updates.pagesDiscovered !== undefined) {
    fields.push(`pages_discovered = $${++paramCount}`);
    values.push(updates.pagesDiscovered);
  }
  if (updates.pagesProcessed !== undefined) {
    fields.push(`pages_processed = $${++paramCount}`);
    values.push(updates.pagesProcessed);
  }
  if (updates.pagesIndexed !== undefined) {
    fields.push(`pages_indexed = $${++paramCount}`);
    values.push(updates.pagesIndexed);
  }
  if (updates.totalChunks !== undefined) {
    fields.push(`total_chunks = $${++paramCount}`);
    values.push(updates.totalChunks);
  }
  if (updates.errorMessage !== undefined) {
    fields.push(`error_message = $${++paramCount}`);
    values.push(updates.errorMessage);
  }
  if (updates.errorDetails !== undefined) {
    fields.push(`error_details = $${++paramCount}`);
    values.push(JSON.stringify(updates.errorDetails));
  }

  await client.query(`UPDATE indexing_jobs SET ${fields.join(', ')} WHERE job_id = $1`, values);
}

// Get indexing job by job ID
export async function getIndexingJob(client: PgClient, jobId: string): Promise<IndexingJob | null> {
  try {
    const { rows } = await client.query('SELECT * FROM indexing_jobs WHERE job_id = $1', [jobId]);

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: row.id,
      jobId: row.job_id,
      indexName: row.index_name,
      sourceUrl: row.source_url,
      status: row.status as IndexingStatus,
      initiatedByUser: row.initiated_by_user,
      initiatedByTeam: row.initiated_by_team,
      scope: row.scope as ScopeType,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationSeconds: row.duration_seconds,
      pagesDiscovered: row.pages_discovered || 0,
      pagesProcessed: row.pages_processed || 0,
      pagesIndexed: row.pages_indexed || 0,
      totalChunks: row.total_chunks || 0,
      errorMessage: row.error_message,
      errorDetails: row.error_details || null,
      metadata: row.metadata || {},
    };
  } catch (error) {
    console.error('Error getting indexing job:', error);
    return null;
  }
}

// Get indexing jobs for a user/team
export async function getIndexingJobs(
  client: PgClient,
  context: UserContext,
  limit: number = 20
): Promise<IndexingJob[]> {
  try {
    const { rows } = await client.query(
      `SELECT * FROM indexing_jobs 
       WHERE (initiated_by_user = $1 OR initiated_by_team = $2)
       ORDER BY started_at DESC 
       LIMIT $3`,
      [context.userId, context.teamId, limit]
    );

    return rows.map(row => ({
      id: row.id,
      jobId: row.job_id,
      indexName: row.index_name,
      sourceUrl: row.source_url,
      status: row.status as IndexingStatus,
      initiatedByUser: row.initiated_by_user,
      initiatedByTeam: row.initiated_by_team,
      scope: row.scope as ScopeType,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationSeconds: row.duration_seconds,
      pagesDiscovered: row.pages_discovered || 0,
      pagesProcessed: row.pages_processed || 0,
      pagesIndexed: row.pages_indexed || 0,
      totalChunks: row.total_chunks || 0,
      errorMessage: row.error_message,
      errorDetails: row.error_details || null,
      metadata: row.metadata || {},
    }));
  } catch (error) {
    console.error('Error getting indexing jobs:', error);
    return [];
  }
}
