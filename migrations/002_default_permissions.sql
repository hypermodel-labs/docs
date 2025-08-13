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