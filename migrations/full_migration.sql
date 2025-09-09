-- Migration: Add scope and user/team linking support
-- Version: 001
-- Description: Creates tables for user session management and document access control

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User/team session linking table
CREATE TABLE IF NOT EXISTS user_links (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    user_id TEXT,
    team_id TEXT,
    scope TEXT DEFAULT 'user' CHECK (scope IN ('user', 'team')),
    linked_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Constraints
    CONSTRAINT valid_link CHECK (
        (scope = 'user' AND user_id IS NOT NULL AND team_id IS NULL) OR
        (scope = 'team' AND team_id IS NOT NULL AND user_id IS NOT NULL)
    )
);

-- Document access permissions table
CREATE TABLE IF NOT EXISTS doc_access (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    team_id TEXT,
    scope TEXT NOT NULL CHECK (scope IN ('user', 'team')),
    index_name TEXT NOT NULL,
    access_level TEXT DEFAULT 'read' CHECK (access_level IN ('read', 'write', 'admin')),
    granted_by TEXT,
    granted_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,
    
    -- Unique constraint to prevent duplicate permissions
    UNIQUE(user_id, team_id, scope, index_name),
    
    -- Constraints
    CONSTRAINT valid_access CHECK (
        (scope = 'user' AND user_id IS NOT NULL AND team_id IS NULL) OR
        (scope = 'team' AND team_id IS NOT NULL)
    )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_links_session ON user_links(session_id);
CREATE INDEX IF NOT EXISTS idx_user_links_user ON user_links(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_links_team ON user_links(team_id) WHERE team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doc_access_user ON doc_access(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_access_team ON doc_access(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_access_index ON doc_access(index_name);
CREATE INDEX IF NOT EXISTS idx_doc_access_scope ON doc_access(scope);

-- Update trigger for user_links
CREATE OR REPLACE FUNCTION update_user_links_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_links_update_timestamp
    BEFORE UPDATE ON user_links
    FOR EACH ROW
    EXECUTE FUNCTION update_user_links_timestamp();

-- Function to clean up expired access permissions
CREATE OR REPLACE FUNCTION cleanup_expired_access()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM doc_access 
    WHERE expires_at IS NOT NULL AND expires_at < now();
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE user_links IS 'Maps MCP session IDs to user/team identities with scope context';
COMMENT ON TABLE doc_access IS 'Controls user and team access permissions to documentation indexes';
COMMENT ON FUNCTION cleanup_expired_access() IS 'Removes expired access permissions - should be called periodically';

-- Migration: Add default permissions for existing documentation indexes
-- Version: 002
-- Description: Grants universal read access to all existing docs_* tables for backward compatibility

-- Function to grant default access to existing indexes
CREATE OR REPLACE FUNCTION grant_default_access_to_existing_indexes()
RETURNS INTEGER AS $$
DECLARE
    table_record RECORD;
    v_index_name TEXT;
    inserted_count INTEGER := 0;
BEGIN
    -- Get all existing docs_* tables
    FOR table_record IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename LIKE 'docs_%'
    LOOP
        -- Extract index name by removing 'docs_' prefix
        v_index_name := replace(table_record.tablename, 'docs_', '');
        
        -- Insert a universal access record for this index
        -- This allows any user to access existing documentation
        INSERT INTO doc_access (user_id, team_id, scope, index_name, access_level, granted_by)
        VALUES ('__anonymous__', null, 'user', v_index_name, 'read', 'system_migration')
        ON CONFLICT (user_id, team_id, scope, index_name) DO NOTHING;
        
        inserted_count := inserted_count + 1;
    END LOOP;
    
    RETURN inserted_count;
END;
$$ LANGUAGE plpgsql;

-- Execute the function to grant default access
SELECT grant_default_access_to_existing_indexes() as granted_indexes;

-- Drop the function as it's no longer needed
DROP FUNCTION grant_default_access_to_existing_indexes();

-- Add a system user record for backward compatibility
-- This allows unlinked sessions to access public documentation
INSERT INTO user_links (session_id, user_id, team_id, scope)
VALUES ('__system_default__', '__anonymous__', null, 'user')
ON CONFLICT (session_id) DO NOTHING;


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


-- Migration: Create users table
-- This migration creates the users table to store user information from WorkOS

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email_verified BOOLEAN NOT NULL DEFAULT false,
    profile_picture_url TEXT,
    workos_id VARCHAR(255) NOT NULL UNIQUE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_workos_id ON users(workos_id);
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_users_created_at ON users(created_at);

-- Add constraints
ALTER TABLE users ADD CONSTRAINT users_email_check 
    CHECK (email ~* '^[A-Za-z0-9._%-]+@[A-Za-z0-9.-]+[.][A-Za-z]+$');

-- Create trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();


-- Migration: Create teams table and team_users junction table
-- This migration creates the teams table and the many-to-many relationship between users and teams

CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create team_users junction table for many-to-many relationship
CREATE TABLE IF NOT EXISTS team_users (
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id)
);

-- Create indexes for better query performance
CREATE INDEX idx_teams_name ON teams(name);
CREATE INDEX idx_teams_created_at ON teams(created_at);

CREATE INDEX idx_team_users_team_id ON team_users(team_id);
CREATE INDEX idx_team_users_user_id ON team_users(user_id);
CREATE INDEX idx_team_users_role ON team_users(role);
CREATE INDEX idx_team_users_joined_at ON team_users(joined_at);

-- Add constraints for team roles
ALTER TABLE team_users ADD CONSTRAINT team_users_role_check 
    CHECK (role IN ('owner', 'admin', 'member'));

-- Ensure team names are unique (case-insensitive)
CREATE UNIQUE INDEX idx_teams_name_unique ON teams(LOWER(name));

-- Create trigger to automatically update updated_at for teams
CREATE TRIGGER update_teams_updated_at 
    BEFORE UPDATE ON teams 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add some useful comments
COMMENT ON TABLE teams IS 'Teams that can contain multiple users';
COMMENT ON TABLE team_users IS 'Junction table linking users to teams with roles';
COMMENT ON COLUMN team_users.role IS 'User role in the team: owner, admin, or member';


-- Migration: Add user and team permissions integration
-- This migration extends the existing scope and permissions system to work with users and teams

-- Add foreign key relationships to existing scope tables if they exist
DO $$
BEGIN
    -- Check if scope_users table exists and add user_id reference
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'scope_users') THEN
        -- Add user_id column if it doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'scope_users' AND column_name = 'user_id') THEN
            ALTER TABLE scope_users ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
            CREATE INDEX idx_scope_users_user_id ON scope_users(user_id);
        END IF;
    END IF;

    -- Check if scope_teams table exists and add team_id reference
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'scope_teams') THEN
        -- Add team_id column if it doesn't exist
        IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_name = 'scope_teams' AND column_name = 'team_id') THEN
            ALTER TABLE scope_teams ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE CASCADE;
            CREATE INDEX idx_scope_teams_team_id ON scope_teams(team_id);
        END IF;
    END IF;
END $$;

-- Create a view to get user permissions across teams
CREATE OR REPLACE VIEW user_team_permissions AS
SELECT DISTINCT
    u.id as user_id,
    u.email,
    t.id as team_id,
    t.name as team_name,
    tu.role as team_role,
    'team' as scope_type
FROM users u
JOIN team_users tu ON u.id = tu.user_id
JOIN teams t ON tu.team_id = t.id
WHERE u.deleted_at IS NULL

UNION ALL

SELECT
    u.id as user_id,
    u.email,
    NULL as team_id,
    NULL as team_name,
    'user' as team_role,
    'user' as scope_type
FROM users u
WHERE u.deleted_at IS NULL;

-- Create function to check if user has access to a team
CREATE OR REPLACE FUNCTION user_has_team_access(p_user_id UUID, p_team_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM team_users tu
        JOIN users u ON tu.user_id = u.id
        WHERE tu.user_id = p_user_id 
        AND tu.team_id = p_team_id
        AND u.deleted_at IS NULL
    );
END;
$$ LANGUAGE plpgsql;

-- Create function to get user's teams
CREATE OR REPLACE FUNCTION get_user_teams(p_user_id UUID)
RETURNS TABLE(team_id UUID, team_name VARCHAR, role VARCHAR, joined_at TIMESTAMP WITH TIME ZONE) AS $$
BEGIN
    RETURN QUERY
    SELECT t.id, t.name, tu.role, tu.joined_at
    FROM teams t
    JOIN team_users tu ON t.id = tu.team_id
    JOIN users u ON tu.user_id = u.id
    WHERE tu.user_id = p_user_id
    AND u.deleted_at IS NULL
    ORDER BY tu.joined_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Add comments for documentation
COMMENT ON VIEW user_team_permissions IS 'View showing all user permissions across individual user scope and team memberships';
COMMENT ON FUNCTION user_has_team_access IS 'Check if a user has access to a specific team';
COMMENT ON FUNCTION get_user_teams IS 'Get all teams a user belongs to with their roles';
