import { Request, Response } from 'express';
import { WorkOSWebhookHandler } from './webhooks.js';
import { WorkOSWebhookEvent } from './types.js';
// import { WorkOS } from '@workos-inc/node';

const webhookHandler = new WorkOSWebhookHandler();

export async function handleWorkOSWebhook(req: Request, res: Response): Promise<void> {
  try {
    const signature = req.headers['workos-signature'] as string;
    const webhookSecret = process.env.WORKOS_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      res.status(400).json({ error: 'Missing webhook signature or secret' });
      return;
    }

    const payload = JSON.parse(JSON.stringify(req.body));
    console.warn('[payload]', payload);
    try {
      // FIXME: this is not working, uncomment when it works
      // const workos = new WorkOS(process.env.WORKOS_CLIENT_SECRET);
      // const event = await workos.webhooks.constructEvent({
      //   payload,
      //   sigHeader: signature,
      //   secret: webhookSecret,
      // });

      // // Validate event structure
      // if (!event.id || !event.event || !event.data) {
      //   res.status(400).json({ error: 'Invalid webhook payload structure' });
      //   return;
      // }

      // Process the webhook event
      await webhookHandler.handleWebhook(payload as unknown as WorkOSWebhookEvent);

      res.status(200).json({ success: true, processed: payload.id });
    } catch (verificationError) {
      console.error('Webhook signature verification failed:', verificationError);
      res.status(400).json({ error: 'Webhook signature verification failed' });
      return;
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getUserProfile(req: Request, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    if (!userId) {
      res.status(400).json({ error: 'User ID required' });
      return;
    }

    // This would typically be protected by authentication middleware
    // For now, we'll just return a placeholder response
    res.status(501).json({ error: 'Not implemented - requires authentication middleware' });
  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function listTeamUsers(req: Request, res: Response): Promise<void> {
  try {
    const { teamId } = req.params;

    if (!teamId) {
      res.status(400).json({ error: 'Team ID required' });
      return;
    }

    // This would typically be protected by authentication middleware
    // For now, we'll just return a placeholder response
    res.status(501).json({ error: 'Not implemented - requires authentication middleware' });
  } catch (error) {
    console.error('List team users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
