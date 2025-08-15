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
