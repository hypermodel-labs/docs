import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response, NextFunction } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
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

class SSETransportManager {
  private transports: Map<string, SSEServerTransport>;

  constructor() {
    this.transports = new Map();
  }

  addTransport(transport: SSEServerTransport): string {
    const sessionId = transport.sessionId;
    this.transports.set(sessionId, transport);
    return sessionId;
  }

  removeTransport(sessionId: string) {
    if (this.transports.has(sessionId)) {
      this.transports.delete(sessionId);
    }
  }

  getTransport(sessionId: string): SSEServerTransport | undefined {
    return this.transports.get(sessionId);
  }

  getAllTransports(): SSEServerTransport[] {
    return Array.from(this.transports.values());
  }
}

const DEFAULT_PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
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
  const sseTransportManager = new SSETransportManager();

  // BEFORE registering routes: lightweight CORS for MCP
  const allowHeaders = 'content-type, authorization, mcp-session-id';
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.get('origin') || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Headers', allowHeaders);
    // Streamable HTTP needs to READ and EXPOSE mcp-session-id
    res.header('Access-Control-Expose-Headers', 'mcp-session-id');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // tiny cookie helper (avoid global cookie-parser to not interfere with streaming)
  function getCookie(req: Request, name: string): string | undefined {
    const cookie = req.headers.cookie;
    if (!cookie) return;
    const match = cookie
      .split(';')
      .map(v => v.trim())
      .find(v => v.startsWith(name + '='));
    return match ? decodeURIComponent(match.split('=').slice(1).join('=')) : undefined;
  }

  // REGISTER MCP ENDPOINT FIRST - before any middleware that might consume the stream
  app.all('/mcp', async (req: Request, res: Response) => {
    try {
      // ---- CORS exposure is already set globally in your middleware ----
      // Read session id from header OR cookie OR query
      const incomingSessionId =
        req.get('mcp-session-id') ||
        getCookie(req, 'mcp-session-id') ||
        (req.query.sessionId as string | undefined);

      // Allow auth only on POST (message channel). GET/DELETE must not require Authorization header.
      const isPost = req.method.toUpperCase() === 'POST';
      if (opts?.oauth && isPost) {
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
        const oauthModule = opts.oauth as unknown as {
          verifyBearer: (req: Request, res: Response, next: NextFunction) => void;
        };
        const isValidToken = await new Promise<boolean>(resolve => {
          const mockReq = { get: (name: string) => req.get(name) } as Request;
          const mockRes = {
            status: () => ({ json: () => resolve(false) }),
            setHeader: () => mockRes,
          } as unknown as Response;
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

      // ---- Existing session path ----
      if (incomingSessionId) {
        const existing = transportManager.getTransport(incomingSessionId);
        if (!existing) {
          return res.status(400).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Unknown session id' },
            id: null,
          });
        }
        // Route this request to the SAME transport instance
        return await existing.handleRequest(req, res);
      }

      // ---- No session id: only POST may create a new session ----
      if (!isPost) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: Server not initialized' },
          id: null,
        });
      }

      // Create transport ONCE for this new session
      let pendingCookieId: string | undefined;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => {
          pendingCookieId = randomUUID();
          // pre-set cookie so the client’s GET /mcp can carry it automatically
          // (EventSource can't set headers; cookie works)
          res.setHeader(
            'Set-Cookie',
            `mcp-session-id=${pendingCookieId}; Path=/; HttpOnly; SameSite=None; Secure`
          );
          return pendingCookieId!;
        },
        onsessioninitialized: (sessionId: string) => {
          console.error(`HTTP streaming session initialized: ${sessionId}`);
          transportManager.addTransport(transport);
        },
        onsessionclosed: (sessionId: string) => {
          console.error(`HTTP streaming session closed: ${sessionId}`);
          transportManager.removeTransport(sessionId);
        },
      });

      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to handle MCP request' });
      }
    }
  });

  // SSE fallback endpoints (kept independent from /mcp)
  app.get('/sse', async (req: Request, res: Response) => {
    try {
      const sseTransport = new SSEServerTransport('/sse', res, {
        enableDnsRebindingProtection: false,
      });

      const sessionId = sseTransport.sessionId;
      sseTransportManager.addTransport(sseTransport);

      res.on('close', () => {
        sseTransportManager.removeTransport(sessionId);
        sseTransport.close().catch(() => {});
      });

      sseTransport.onerror = err => {
        console.error('SSE transport error:', err);
      };

      await server.connect(sseTransport);
      console.error(`SSE session initialized: ${sessionId}`);
    } catch (error) {
      console.error('Error establishing SSE stream:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE stream' });
      }
    }
  });

  // IMPORTANT: parse JSON for SSE message posts (body is not a stream here)
  app.post('/sse', express.json({ limit: '10mb' }), async (req: Request, res: Response) => {
    const sessionId = (req.query.sessionId as string) || '';
    if (!sessionId) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Missing sessionId parameter' },
        id: null,
      });
    }

    // Keep /sse independent from /mcp: block HTTP streaming sessions here
    if (transportManager.getTransport(sessionId)) {
      return res.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message:
            'Session belongs to HTTP streaming transport. Use /mcp endpoint for this session.',
        },
        id: null,
      });
    }

    const sseTransport = sseTransportManager.getTransport(sessionId);
    if (!sseTransport) {
      return res.status(404).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'SSE session not found. Establish stream with GET /sse first.',
        },
        id: null,
      });
    }

    try {
      await sseTransport.handlePostMessage(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
        req.body // now defined
      );
    } catch (error) {
      console.error('Error handling SSE POST message:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
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
        `Port ${DEFAULT_PORT} is already in use. MCP Server running at http://localhost:${port}`
      );
    } else {
      console.error(`MCP Server running at http://localhost:${port}`);
    }
  });

  return app;
}
