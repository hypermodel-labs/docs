export const SERVER_NAME: string = '@hypermodel-labs/docs-mcp';
export const SERVER_VERSION: string = '0.0.1';

// Embedding provider configuration
export const DEFAULT_EMBEDDING_PROVIDER = 'openai';
export const DEFAULT_VECTOR_DIMENSION = 512;
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
export const DEFAULT_GEMINI_VECTOR_DIMENSION = 768;

// Get embedding provider from environment variable, default to OpenAI
export function getEmbeddingProvider(): 'openai' | 'gemini' {
  const provider = process.env.EMBEDDING_PROVIDER?.toLowerCase();
  if (provider === 'gemini') {
    return 'gemini';
  }
  return 'openai';
}

// Get appropriate model and dimensions based on provider
export function getEmbeddingConfig() {
  const provider = getEmbeddingProvider();

  if (provider === 'gemini') {
    return {
      provider: 'gemini' as const,
      model: process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_GEMINI_EMBEDDING_MODEL,
      dimensions: parseInt(
        process.env.GEMINI_EMBEDDING_DIMENSIONS || String(DEFAULT_GEMINI_VECTOR_DIMENSION)
      ),
      apiKey: process.env.GEMINI_API_KEY,
    };
  }

  return {
    provider: 'openai' as const,
    model: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    dimensions: parseInt(
      process.env.OPENAI_EMBEDDING_DIMENSIONS || String(DEFAULT_VECTOR_DIMENSION)
    ),
    apiKey: process.env.OPENAI_API_KEY,
  };
}
