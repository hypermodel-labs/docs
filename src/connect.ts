import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response, NextFunction } from 'express';
import { detect } from 'detect-port';
import { randomUUID } from 'crypto';
import type { OAuthModule } from './oauth/oauth';
import type { UserModule } from './user/user';

/**
 * Similar to https://github.com/modelcontextprotocol/typescript-sdk/pull/197/files
 */
class TransportManager {
  private transports: Map<string, StreamableHTTPServerTransport>;

  constructor() {
    this.transports = new Map();
  }

  addTransport(transport: StreamableHTTPServerTransport): string {
    const sessionId = transport.sessionId;
    if (sessionId) {
      this.transports.set(sessionId, transport);
    }
    return sessionId || 'default';
  }

  removeTransport(sessionId: string) {
    if (this.transports.has(sessionId)) {
      this.transports.delete(sessionId);
    }
  }

  getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    return this.transports.get(sessionId);
  }

  getAllTransports(): StreamableHTTPServerTransport[] {
    return Array.from(this.transports.values());
  }
}

const DEFAULT_PORT = 3001;
export async function connectServer(
  server: McpServer,
  useStdioTransport: boolean,
  opts?: { oauth?: OAuthModule; user?: UserModule }
): Promise<express.Application | undefined> {
  if (useStdioTransport) {
    console.error('Connecting to MCP server over stdio');
    const transport = new StdioServerTransport();
    await server.connect(transport);
    return;
  }
  const app = express();
  // Ensure Express respects X-Forwarded-* headers when behind a proxy/CDN (e.g., Cloudflare)
  // This makes req.protocol reflect the original scheme (https) for correct metadata URLs
  app.set('trust proxy', true);
  const port = await detect(DEFAULT_PORT);
  const transportManager = new TransportManager();

  // Create a transport for HTTP streaming
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId: string) => {
      console.error(`HTTP streaming session initialized: ${sessionId}`);
      transportManager.addTransport(transport);
    },
    onsessionclosed: (sessionId: string) => {
      console.error(`HTTP streaming session closed: ${sessionId}`);
      transportManager.removeTransport(sessionId);
    },
  });

  // Connect the server to the transport
  await server.connect(transport);

  // REGISTER MCP ENDPOINT FIRST - before any middleware that might consume the stream
  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      // Bearer authentication without consuming the stream
      if (opts?.oauth) {
        const header = req.get('authorization');
        if (!header || !header.toLowerCase().startsWith('bearer ')) {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const metaUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
          res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metaUrl}"`);
          return res.status(401).json({
            error: 'invalid_token',
            error_description: 'Missing Authorization header',
          });
        }

        const token = header.slice(7).trim();

        // Use OAuth module's internal token verification
        const oauthModule = opts.oauth as any;
        const isValidToken = await new Promise<boolean>(resolve => {
          // Create minimal req/res objects for verification
          const mockReq = { get: (name: string) => req.get(name) } as Request;
          const mockRes = {
            status: () => ({ json: () => resolve(false) }),
            setHeader: () => mockRes,
          } as any as Response;
          const mockNext = () => resolve(true);

          oauthModule.verifyBearer(mockReq, mockRes, mockNext);
        });

        if (!isValidToken) {
          const baseUrl = `${req.protocol}://${req.get('host')}`;
          const metaUrl = `${baseUrl}/.well-known/oauth-protected-resource`;
          res.setHeader('WWW-Authenticate', `Bearer realm="mcp", resource_metadata="${metaUrl}"`);
          return res.status(401).json({
            error: 'invalid_token',
            error_description: 'Invalid or expired token',
          });
        }
      }

      // Handle the MCP request with the transport
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to handle MCP request' });
      }
    }
  });

  // Now add other middleware AFTER the MCP endpoint is registered
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Install OAuth endpoints if provided
  if (opts?.oauth) {
    opts.oauth.install(app);
  }

  // Install User endpoints if provided
  if (opts?.user) {
    opts.user.install(app);
  }

  app.listen(port, () => {
    if (port !== DEFAULT_PORT) {
      console.error(
        `Port ${DEFAULT_PORT} is already in use. MCP Server running on HTTP streaming at http://localhost:${port}`
      );
    } else {
      console.error(`MCP Server running on HTTP streaming at http://localhost:${port}`);
    }
  });

  return app;
}
