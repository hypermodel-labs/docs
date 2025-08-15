import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { connectServer } from './connect';
import { initialise } from './initialise';
import { createDocsTool } from './docs';
import express from 'express';
import { createOAuthModule } from './oauth/oauth';
import { createUserModule } from './user/user';

const args = process.argv.slice(2);
const useStdioTransport =
  args.includes('--transport') && args[args.indexOf('--transport') + 1] === 'stdio';

async function main(): Promise<express.Application | undefined> {
  const server = initialise() as McpServer;
  createDocsTool(server);
  const oauth = createOAuthModule({ mcpPath: '/mcp' });
  const user = createUserModule();
  const app = connectServer(server, useStdioTransport, { oauth, user });
  return app;
}

let mcpApp: Promise<express.Application | undefined> | null = null;

try {
  mcpApp = main();
} catch (error) {
  console.error('Fatal error in trying to initialize MCP server: ', error);
  process.exit(1);
}

export { mcpApp };
