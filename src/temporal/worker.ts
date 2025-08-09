import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

config();

async function run() {
  const temporalAddress = process.env.TEMPORAL_ADDRESS;
  const temporalNamespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const temporalTlsCert = process.env.TEMPORAL_TLS_CERT;
  const temporalTlsKey = process.env.TEMPORAL_TLS_KEY;

  if (!temporalAddress) {
    throw new Error('TEMPORAL_ADDRESS environment variable is required');
  }

  let connection: NativeConnection;

  // Configure TLS for Temporal Cloud
  if (process.env.NODE_ENV !== 'development' && temporalTlsCert && temporalTlsKey) {
    connection = await NativeConnection.connect({
      apiKey: process.env.TEMPORAL_API_KEY,
      address: temporalAddress,
      tls: {
        clientCertPair: {
          // Expect base64-encoded cert and key to match docs and client config
          crt: Buffer.from(temporalTlsCert, 'utf8'),
          key: Buffer.from(temporalTlsKey, 'utf8'),
        },
      },
    });
  } else {
    // For local development without TLS
    connection = await NativeConnection.connect({
      address: temporalAddress,
    });
  }

  const worker = await Worker.create({
    connection,
    namespace: temporalNamespace,
    // In ESM, `require` is not available. Resolve path relative to this file.
    workflowsPath: path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows.js'),
    activities,
    taskQueue: 'docs-indexing',
  });

  console.warn('Worker started, listening on task queue: docs-indexing');
  await worker.run();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
