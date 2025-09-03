import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

export interface EmbeddingProvider {
  embedBatch(texts: string[]): Promise<number[][]>;
  getDimensions(): number;
  getModel(): string;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model: string, dimensions: number) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    });

    return response.data.map(d => d.embedding);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModel(): string {
    return this.model;
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private client: GoogleGenAI;
  private model: string;
  private dimensions: number;

  constructor(apiKey: string, model: string = 'gemini-embedding-001', dimensions: number = 768) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await this.client.models.embedContent({
      model: this.model,
      contents: texts,
      outputDimensionality: this.dimensions,
    });

    if (!response.embeddings) {
      throw new Error('No embeddings returned from Gemini API');
    }

    // According to Gemini docs, only 3072 dimension embeddings are pre-normalized
    // All other dimensions need manual normalization
    const embeddings = response.embeddings.map(embedding => {
      const values = embedding.values;

      if (!values) {
        throw new Error('No values in embedding response');
      }

      if (this.dimensions !== 3072) {
        // Normalize the embedding vector for better semantic similarity
        const magnitude = Math.sqrt(values.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0) {
          throw new Error('Zero magnitude embedding vector');
        }
        return values.map(val => val / magnitude);
      }

      return values;
    });

    return embeddings;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getModel(): string {
    return this.model;
  }
}

export function createEmbeddingProvider(
  provider: 'openai' | 'gemini',
  apiKey: string,
  model: string,
  dimensions: number
): EmbeddingProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIEmbeddingProvider(apiKey, model, dimensions);
    case 'gemini':
      return new GeminiEmbeddingProvider(apiKey, model, dimensions);
    default:
      throw new Error(`Unsupported embedding provider: ${provider}`);
  }
}
