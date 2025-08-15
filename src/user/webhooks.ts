import { Client as PgClient } from 'pg';
import { WorkOSWebhookEvent, WorkOSUser } from './types';
import {
  createUser,
  getUserByWorkosId,
  updateUser,
  softDeleteUser,
  createTeam,
  addUserToTeam,
} from './database';

export class WorkOSWebhookHandler {
  async handleWebhook(event: WorkOSWebhookEvent): Promise<void> {
    console.warn(`Processing WorkOS webhook: ${event.event} for user ${event.data.id}`);

    const connectionString = process.env.POSTGRES_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('POSTGRES_CONNECTION_STRING not set');
    }

    const client = new PgClient({ connectionString });
    try {
      await client.connect();

      switch (event.event) {
        case 'user.created':
          await this.handleUserCreated(client, event.data);
          break;
        case 'user.updated':
          await this.handleUserUpdated(client, event.data);
          break;
        case 'user.deleted':
          await this.handleUserDeleted(client, event.data);
          break;
        default:
          console.warn(`Unhandled webhook event: ${event.event}`);
      }
    } catch (error) {
      console.error(`Error processing webhook ${event.event}:`, error);
      throw error;
    } finally {
      await client.end();
    }
  }

  private async handleUserCreated(client: PgClient, user: WorkOSUser): Promise<void> {
    const existingUser = await getUserByWorkosId(client, user.id);

    if (existingUser) {
      console.warn(`User ${user.id} already exists, skipping creation`);
      return;
    }

    const userData = {
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      email_verified: user.email_verified,
      profile_picture_url: user.profile_picture_url,
      workos_id: user.id,
    };

    const createdUser = await createUser(client, userData);
    console.warn(`Created user: ${createdUser.id} (WorkOS: ${user.id})`);

    // Create a team for the new user
    const userName = user.first_name || user.email.split('@')[0];
    const teamName = `${userName}'s team`;

    const teamData = {
      name: teamName,
      description: `Personal team for ${userName}`,
    };

    const createdTeam = await createTeam(client, teamData);
    console.warn(`Created team: ${createdTeam.id} (${teamName})`);

    // Assign admin role to the user for their team
    await addUserToTeam(client, createdTeam.id, createdUser.id, 'admin');
    console.warn(`Assigned admin role to user ${createdUser.id} for team ${createdTeam.id}`);
  }

  private async handleUserUpdated(client: PgClient, user: WorkOSUser): Promise<void> {
    const existingUser = await getUserByWorkosId(client, user.id);

    if (!existingUser) {
      console.warn(
        `Warning: Update attempted on non-existing or deleted user ${user.id}. Skipping update.`
      );
      return;
    }

    const updateData = {
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      email_verified: user.email_verified,
      profile_picture_url: user.profile_picture_url,
    };

    const updatedUser = await updateUser(client, user.id, updateData);
    console.warn(`Updated user: ${updatedUser?.id} (WorkOS: ${user.id})`);
  }

  private async handleUserDeleted(client: PgClient, user: WorkOSUser): Promise<void> {
    const existingUser = await getUserByWorkosId(client, user.id);

    if (!existingUser) {
      console.warn(`User ${user.id} not found, skipping deletion`);
      return;
    }

    const deletedUser = await softDeleteUser(client, user.id);
    console.warn(`Soft deleted user: ${deletedUser?.id} (WorkOS: ${user.id})`);
  }
}
