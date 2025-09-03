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

  constructor(apiKey: string, model: string = 'gemini-embedding-001', dimensions: number = 3072) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
    this.dimensions = dimensions;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    console.warn(
      `Gemini API request: model=${this.model}, texts=${texts.length}, requestedDimensions=${this.dimensions}`
    );

    // For now, use default dimensions since outputDimensionality seems to be ignored
    const response = await this.client.models.embedContent({
      model: this.model,
      contents: texts,
    });

    if (!response.embeddings) {
      throw new Error('No embeddings returned from Gemini API');
    }

    console.warn(`Gemini API response: got ${response.embeddings.length} embeddings`);

    // Check actual dimensions returned
    const firstEmbedding = response.embeddings[0];
    if (firstEmbedding?.values) {
      const actualDimensions = firstEmbedding.values.length;
      console.warn(
        `Gemini API actual dimensions: ${actualDimensions}, configured: ${this.dimensions}`
      );

      // Update our dimensions to match what the API actually returns
      if (actualDimensions !== this.dimensions) {
        console.warn(
          `Updating dimensions from ${this.dimensions} to ${actualDimensions} to match API response`
        );
        this.dimensions = actualDimensions;
      }
    }

    // According to Gemini docs, 3072 dimension embeddings are pre-normalized
    // All other dimensions need manual normalization
    const embeddings = response.embeddings.map(embedding => {
      const values = embedding.values;

      if (!values) {
        throw new Error('No values in embedding response');
      }

      // Gemini's default is 3072 dimensions and they come pre-normalized
      if (values.length !== 3072) {
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
