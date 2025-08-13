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