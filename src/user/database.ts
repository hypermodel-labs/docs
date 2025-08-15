import { Client as PgClient } from 'pg';
import { UserRecord, TeamRecord, TeamUserRecord } from './types.js';

export async function createUser(
  client: PgClient,
  userData: Omit<UserRecord, 'id' | 'created_at' | 'updated_at'>
): Promise<UserRecord> {
  const query = `
    INSERT INTO users (email, first_name, last_name, email_verified, profile_picture_url, workos_id)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;

  const result = await client.query(query, [
    userData.email,
    userData.first_name,
    userData.last_name,
    userData.email_verified,
    userData.profile_picture_url,
    userData.workos_id,
  ]);

  return result.rows[0];
}

export async function updateUser(
  client: PgClient,
  workosId: string,
  userData: Partial<Omit<UserRecord, 'id' | 'workos_id' | 'created_at' | 'updated_at'>>
): Promise<UserRecord | null> {
  const setClause = Object.keys(userData)
    .map((key, index) => `${key} = $${index + 2}`)
    .join(', ');

  const query = `
    UPDATE users 
    SET ${setClause}, updated_at = NOW()
    WHERE workos_id = $1 AND deleted_at IS NULL
    RETURNING *
  `;

  const values = [workosId, ...Object.values(userData)];
  const result = await client.query(query, values);

  return result.rows[0] || null;
}

export async function softDeleteUser(
  client: PgClient,
  workosId: string
): Promise<UserRecord | null> {
  const query = `
    UPDATE users 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE workos_id = $1 AND deleted_at IS NULL
    RETURNING *
  `;

  const result = await client.query(query, [workosId]);
  return result.rows[0] || null;
}

export async function getUserByWorkosId(
  client: PgClient,
  workosId: string
): Promise<UserRecord | null> {
  const query = `
    SELECT * FROM users 
    WHERE workos_id = $1 AND deleted_at IS NULL
  `;

  const result = await client.query(query, [workosId]);
  return result.rows[0] || null;
}

export async function getUserByEmail(client: PgClient, email: string): Promise<UserRecord | null> {
  const query = `
    SELECT * FROM users 
    WHERE email = $1 AND deleted_at IS NULL
  `;

  const result = await client.query(query, [email]);
  return result.rows[0] || null;
}

export async function createTeam(
  client: PgClient,
  teamData: Omit<TeamRecord, 'id' | 'created_at' | 'updated_at'>
): Promise<TeamRecord> {
  const query = `
    INSERT INTO teams (name, description)
    VALUES ($1, $2)
    RETURNING *
  `;

  const result = await client.query(query, [teamData.name, teamData.description]);
  return result.rows[0];
}

export async function addUserToTeam(
  client: PgClient,
  teamId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member' = 'member'
): Promise<TeamUserRecord> {
  const query = `
    INSERT INTO team_users (team_id, user_id, role)
    VALUES ($1, $2, $3)
    ON CONFLICT (team_id, user_id) 
    DO UPDATE SET role = EXCLUDED.role, joined_at = NOW()
    RETURNING *
  `;

  const result = await client.query(query, [teamId, userId, role]);
  return result.rows[0];
}

export async function removeUserFromTeam(
  client: PgClient,
  teamId: string,
  userId: string
): Promise<boolean> {
  const query = `
    DELETE FROM team_users 
    WHERE team_id = $1 AND user_id = $2
  `;

  const result = await client.query(query, [teamId, userId]);
  return (result.rowCount ?? 0) > 0;
}

export async function getTeamUsers(
  client: PgClient,
  teamId: string
): Promise<(UserRecord & { role: string; joined_at: Date })[]> {
  const query = `
    SELECT u.*, tu.role, tu.joined_at
    FROM users u
    JOIN team_users tu ON u.id = tu.user_id
    WHERE tu.team_id = $1 AND u.deleted_at IS NULL
    ORDER BY tu.joined_at ASC
  `;

  const result = await client.query(query, [teamId]);
  return result.rows;
}
