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
