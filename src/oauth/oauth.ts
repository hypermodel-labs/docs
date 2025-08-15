import express, { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

type OAuthRequestInfo = {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  state?: string;
  scope?: string;
  resource?: string;
};

export type OAuthModule = {
  install(app: express.Application): void;
  verifyBearer: (req: Request, res: Response, next: NextFunction) => void;
};

export function createOAuthModule(options?: { ssePath?: string }): OAuthModule {
  const ssePath = options?.ssePath ?? '/sse';

  // In-memory stores for demo purposes only
  const authorizationCodes = new Map<string, { oauth: OAuthRequestInfo; expiresAt: number }>();
  const accessTokens = new Map<string, { scope?: string; expiresAt?: number }>();
  const refreshTokens = new Map<string, { scope?: string }>();
  const pendingStates = new Map<string, OAuthRequestInfo>();

  function baseUrlFor(req: Request): string {
    return `${req.protocol}://${req.get('host')}`;
  }

  function install(app: express.Application): void {
    // Ensure parsers are in place
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: false }));

    // Authorization Server Metadata (RFC 8414)
    app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
      const baseUrl = baseUrlFor(req);
      res.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'profile', 'email'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      });
    });

    // Protected Resource Metadata (RFC 9728)
    app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
      const baseUrl = baseUrlFor(req);
      res.json({
        resource: `${baseUrl}${ssePath}`,
        authorization_servers: [baseUrl],
      });
    });

    // Dynamic Client Registration (RFC 7591)
    app.post('/register', (req: Request, res: Response) => {
      const clientId = randomUUID();
      const clientSecret = randomUUID();
      res.json({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uris: req.body?.redirect_uris || [],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
      });
    });

    // Authorization endpoint - proxy to WorkOS (AuthKit) like other demo
    app.get('/authorize', async (req: Request, res: Response) => {
      try {
        const oauthReq: OAuthRequestInfo = {
          clientId: String(req.query.client_id || ''),
          redirectUri: String(req.query.redirect_uri || ''),
          codeChallenge: req.query.code_challenge ? String(req.query.code_challenge) : undefined,
          codeChallengeMethod: req.query.code_challenge_method
            ? String(req.query.code_challenge_method)
            : undefined,
          state: req.query.state ? String(req.query.state) : undefined,
          scope: req.query.scope ? String(req.query.scope) : undefined,
          resource: req.query.resource ? String(req.query.resource) : undefined,
        };

        if (!oauthReq.clientId || !oauthReq.redirectUri) {
          return res.status(400).send('Missing client_id or redirect_uri');
        }

        const state = Buffer.from(JSON.stringify(oauthReq)).toString('base64url');
        pendingStates.set(state, oauthReq);

        const redirectUri = new URL('/callback', baseUrlFor(req)).href;
        const clientId = process.env.WORKOS_CLIENT_ID as string;
        if (!clientId || !process.env.WORKOS_CLIENT_SECRET) {
          // Fallback: auto-approve locally if WorkOS not configured
          const authCode = randomUUID();
          authorizationCodes.set(authCode, {
            oauth: oauthReq,
            expiresAt: Date.now() + 5 * 60 * 1000,
          });
          const redirect = new URL(oauthReq.redirectUri);
          redirect.searchParams.set('code', authCode);
          if (oauthReq.state) redirect.searchParams.set('state', oauthReq.state);
          return res.redirect(302, redirect.href);
        }

        // @ts-expect-error WorkOS is optional and resolved at runtime
        const { WorkOS } = await import('@workos-inc/node');
        const workOS = new WorkOS(process.env.WORKOS_CLIENT_SECRET || '');
        const authorizationUrl = workOS.userManagement.getAuthorizationUrl({
          provider: 'authkit',
          clientId,
          redirectUri,
          state,
        });
        return res.redirect(authorizationUrl);
      } catch (error) {
        console.error('authorize error', error);
        return res.status(500).send('Failed to start authorization');
      }
    });

    // WorkOS callback -> exchange and redirect back to client with local code
    app.get('/callback', async (req: Request, res: Response) => {
      try {
        const state = String(req.query.state || '');
        const code = String(req.query.code || '');
        if (!state || !code) return res.status(400).send('Missing state or code');

        const oauthReq = pendingStates.get(state);
        if (!oauthReq) return res.status(400).send('Invalid state');
        pendingStates.delete(state);

        const clientId = process.env.WORKOS_CLIENT_ID as string;
        if (!clientId) return res.status(500).send('WORKOS_CLIENT_ID not configured');

        // @ts-expect-error WorkOS is optional and resolved at runtime
        const { WorkOS } = await import('@workos-inc/node');
        const workOS = new WorkOS(process.env.WORKOS_CLIENT_SECRET || '');
        await workOS.userManagement.authenticateWithCode({ clientId, code });

        const authCode = randomUUID();
        authorizationCodes.set(authCode, {
          oauth: oauthReq,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });

        const redirect = new URL(oauthReq.redirectUri);
        redirect.searchParams.set('code', authCode);
        if (oauthReq.state) redirect.searchParams.set('state', oauthReq.state);
        return res.redirect(302, redirect.href);
      } catch (error) {
        console.error('callback error', error);
        return res.status(400).send('Invalid authorization code');
      }
    });

    // Token endpoint
    app.post('/token', (req: Request, res: Response) => {
      try {
        const { grant_type, code, refresh_token } = req.body ?? {};

        if (grant_type === 'authorization_code') {
          if (!code) {
            return res
              .status(400)
              .json({ error: 'invalid_request', error_description: 'Missing code' });
          }
          const record = authorizationCodes.get(String(code));
          if (!record || Date.now() > record.expiresAt) {
            return res
              .status(400)
              .json({ error: 'invalid_grant', error_description: 'Invalid or expired code' });
          }

          authorizationCodes.delete(String(code)); // one-time use

          const accessToken = randomUUID();
          const newRefreshToken = randomUUID();
          accessTokens.set(accessToken, {
            scope: record.oauth.scope,
            expiresAt: Date.now() + 3600 * 1000,
          });
          refreshTokens.set(newRefreshToken, { scope: record.oauth.scope });

          return res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: newRefreshToken,
            scope: record.oauth.scope ?? 'openid profile email',
          });
        }

        if (grant_type === 'refresh_token') {
          if (!refresh_token) {
            return res
              .status(400)
              .json({ error: 'invalid_request', error_description: 'Missing refresh_token' });
          }
          const rec = refreshTokens.get(String(refresh_token));
          if (!rec) {
            return res
              .status(400)
              .json({ error: 'invalid_grant', error_description: 'Invalid refresh_token' });
          }

          const accessToken = randomUUID();
          accessTokens.set(accessToken, { scope: rec.scope, expiresAt: Date.now() + 3600 * 1000 });
          return res.json({
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token,
          });
        }

        return res.status(400).json({
          error: 'unsupported_grant_type',
          error_description: 'Supported grants: authorization_code, refresh_token',
        });
      } catch (error) {
        console.error('Token endpoint error:', error);
        return res
          .status(500)
          .json({ error: 'server_error', error_description: 'Internal server error' });
      }
    });
  }

  function verifyBearer(req: Request, res: Response, next: NextFunction) {
    const header = req.get('authorization');
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      const metaUrl = `${baseUrlFor(req)}/.well-known/oauth-protected-resource`;
      res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metaUrl}"`);
      return res
        .status(401)
        .json({ error: 'invalid_token', error_description: 'Missing Authorization header' });
    }
    const token = header.slice(7).trim();
    const rec = accessTokens.get(token);
    console.warn('[verifyBearer][rec]', rec);
    if (!rec || (rec.expiresAt && Date.now() > rec.expiresAt)) {
      const metaUrl = `${baseUrlFor(req)}/.well-known/oauth-protected-resource`;
      res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metaUrl}"`);
      return res
        .status(401)
        .json({ error: 'invalid_token', error_description: 'Invalid or expired token' });
    }
    return next();
  }

  return { install, verifyBearer };
}
