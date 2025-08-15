import express from 'express';
import { handleWorkOSWebhook, getUserProfile, listTeamUsers } from './routes.js';

export type UserModule = {
  install(app: express.Application): void;
};

export function createUserModule(): UserModule {
  function install(app: express.Application): void {
    // Ensure parsers are in place
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: false }));

    // WorkOS webhook endpoint
    app.post('/webhooks/workos', handleWorkOSWebhook);

    // User management endpoints
    app.get('/api/users/:userId', getUserProfile);
    app.get('/api/teams/:teamId/users', listTeamUsers);
  }

  return { install };
}
