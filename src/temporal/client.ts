import { Client, Connection } from '@temporalio/client';

export async function createTemporalClient(): Promise<Client> {
  const temporalAddress = process.env.TEMPORAL_ADDRESS;
  const temporalNamespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const temporalTlsCert = process.env.TEMPORAL_TLS_CERT;
  const temporalTlsKey = process.env.TEMPORAL_TLS_KEY;

  if (!temporalAddress) {
    throw new Error('TEMPORAL_ADDRESS environment variable is required');
  }

  let connection: Connection;

  // Configure TLS for Temporal Cloud
  if (temporalTlsCert && temporalTlsKey) {
    connection = await Connection.connect({
      address: temporalAddress,
      tls: {
        clientCertPair: {
          crt: Buffer.from(temporalTlsCert, 'utf8'),
          key: Buffer.from(temporalTlsKey, 'utf8'),
        },
      },
    });
  } else {
    // For local development without TLS
    connection = await Connection.connect({
      address: temporalAddress,
    });
  }

  return new Client({
    connection,
    namespace: temporalNamespace,
  });
}
