import { defineConfig } from 'vite';
import { VitePluginNode } from 'vite-plugin-node';
import type { OutputChunk, OutputAsset } from 'rollup';

// Custom plugin to add shebang
function addShebangPlugin() {
  return {
    name: 'add-shebang',
    generateBundle(options: any, bundle: { [fileName: string]: OutputChunk | OutputAsset }) {
      // Add shebang to entry files
      Object.values(bundle).forEach(chunk => {
        if (chunk.type === 'chunk' && chunk.isEntry) {
          chunk.code = `#!/usr/bin/env node\n${chunk.code}`;
        }
      });
    },
  };
}

export default defineConfig(({ command }) => {
  const config = {
    server: {
      port: 3001,
    },
    build: {
      ssr: true,
      outDir: './dist',
      rollupOptions: {
        input: {
          index: './src/index.ts',
          'temporal/worker': './src/temporal/worker.ts',
          'temporal/workflows': './src/temporal/workflows.ts',
          'api/server': './src/api/server.ts',
        },
        output: {
          format: 'es' as const,
          entryFileNames: '[name].js',
        },
        external: [
          'express',
          'dotenv',
          'zod',
          'axios',
          'cheerio',
          'node:crypto',
          'pg',
          'node:os',
          '@temporalio/client',
          '@temporalio/worker',
          '@temporalio/workflow',
          '@google/genai',
        ],
      },
      sourcemap: true,
      target: 'node16',
    },
    plugins: [addShebangPlugin()],
  };

  // Only add VitePluginNode for development/serve
  if (command === 'serve') {
    (config.plugins as any).push(
      ...VitePluginNode({
        adapter: 'express',
        appPath: './src/index.ts',
        exportName: 'mcpApp',
        initAppOnBoot: true,
      })
    );
  }

  return config;
});
