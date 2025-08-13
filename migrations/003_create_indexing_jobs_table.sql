-- Migration: Add indexing job status tracking
-- Version: 003
-- Description: Creates table to track indexing job lifecycle and status

-- Indexing jobs tracking table
CREATE TABLE IF NOT EXISTS indexing_jobs (
    id BIGSERIAL PRIMARY KEY,
    job_id TEXT UNIQUE NOT NULL,           -- Temporal workflow ID
    index_name TEXT NOT NULL,              -- Derived index name
    source_url TEXT NOT NULL,              -- Original URL being indexed
    status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
    
    -- User/team context
    initiated_by_user TEXT,               -- User who started the job
    initiated_by_team TEXT,               -- Team context if applicable
    scope TEXT DEFAULT 'user' CHECK (scope IN ('user', 'team')),
    
    -- Timing information
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    
    -- Progress and results
    pages_discovered INTEGER DEFAULT 0,
    pages_processed INTEGER DEFAULT 0,
    pages_indexed INTEGER DEFAULT 0,
    total_chunks INTEGER DEFAULT 0,
    
    -- Error information
    error_message TEXT,
    error_details JSONB,
    
    -- Additional metadata
    workflow_run_id TEXT,                 -- Temporal run ID
    task_queue TEXT DEFAULT 'docs-indexing',
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_job_id ON indexing_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_index_name ON indexing_jobs(index_name);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status ON indexing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_user ON indexing_jobs(initiated_by_user) WHERE initiated_by_user IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_team ON indexing_jobs(initiated_by_team) WHERE initiated_by_team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_started_at ON indexing_jobs(started_at);

-- Update trigger for indexing_jobs
CREATE OR REPLACE FUNCTION update_indexing_jobs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    
    -- Calculate duration if job is being completed
    IF NEW.status IN ('completed', 'failed', 'timeout', 'cancelled') AND OLD.status NOT IN ('completed', 'failed', 'timeout', 'cancelled') THEN
        NEW.completed_at = now();
        NEW.duration_seconds = EXTRACT(EPOCH FROM (now() - NEW.started_at))::INTEGER;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER indexing_jobs_update_timestamp
    BEFORE UPDATE ON indexing_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_indexing_jobs_timestamp();

-- Function to get job statistics
CREATE OR REPLACE FUNCTION get_indexing_stats(
    user_filter TEXT DEFAULT NULL,
    team_filter TEXT DEFAULT NULL,
    days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
    total_jobs BIGINT,
    completed_jobs BIGINT,
    failed_jobs BIGINT,
    running_jobs BIGINT,
    avg_duration_minutes NUMERIC,
    total_pages_indexed BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*)::BIGINT as total_jobs,
        COUNT(*) FILTER (WHERE status = 'completed')::BIGINT as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'failed')::BIGINT as failed_jobs,
        COUNT(*) FILTER (WHERE status IN ('started', 'running'))::BIGINT as running_jobs,
        ROUND(AVG(duration_seconds) / 60.0, 2) as avg_duration_minutes,
        COALESCE(SUM(pages_indexed), 0)::BIGINT as total_pages_indexed
    FROM indexing_jobs 
    WHERE started_at > now() - INTERVAL '1 day' * days_back
    AND (user_filter IS NULL OR initiated_by_user = user_filter)
    AND (team_filter IS NULL OR initiated_by_team = team_filter);
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old completed jobs
CREATE OR REPLACE FUNCTION cleanup_old_indexing_jobs(days_to_keep INTEGER DEFAULT 90)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM indexing_jobs 
    WHERE status IN ('completed', 'failed', 'cancelled') 
    AND completed_at < now() - INTERVAL '1 day' * days_to_keep;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE indexing_jobs IS 'Tracks the lifecycle and status of documentation indexing jobs';
COMMENT ON COLUMN indexing_jobs.job_id IS 'Temporal workflow ID for tracking';
COMMENT ON COLUMN indexing_jobs.status IS 'Current status: started, running, completed, failed, timeout, cancelled';
COMMENT ON COLUMN indexing_jobs.pages_discovered IS 'Total pages discovered during crawling';
COMMENT ON COLUMN indexing_jobs.pages_processed IS 'Pages that were successfully processed';
COMMENT ON COLUMN indexing_jobs.pages_indexed IS 'Pages that were embedded and stored';
COMMENT ON FUNCTION get_indexing_stats IS 'Returns aggregated statistics for indexing jobs';
COMMENT ON FUNCTION cleanup_old_indexing_jobs IS 'Removes old completed indexing jobs to manage table size';