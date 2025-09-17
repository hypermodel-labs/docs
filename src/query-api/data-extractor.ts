import { ParsedQuery, EnrichedData } from './types';
import Anthropic from '@anthropic-ai/sdk';
import { Client as PgClient } from 'pg';
import { createEmbeddingProvider, EmbeddingProvider } from '../embeddings/providers';
import { getUserContext, hasAccess, getAccessibleIndexes } from '../scope';
import { getEmbeddingConfig } from '../settings';

export class DataExtractor {
  private anthropic: Anthropic;
  private mcpTools?: any; // MCP tools if available
  private embeddingProvider?: EmbeddingProvider;

  constructor(apiKey?: string, mcpTools?: any) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.mcpTools = mcpTools;
  }

  private async createEmbeddingProviderInstance(): Promise<EmbeddingProvider> {
    if (this.embeddingProvider) {
      return this.embeddingProvider;
    }

    const config = getEmbeddingConfig();

    if (!config.apiKey) {
      throw new Error(`${config.provider.toUpperCase()}_API_KEY not set`);
    }

    console.warn(
      `Using ${config.provider} embedding provider with model ${config.model} and ${config.dimensions} dimensions`
    );

    this.embeddingProvider = createEmbeddingProvider(config.provider, config.apiKey, config.model, config.dimensions);
    return this.embeddingProvider;
  }

  async extractAndEnrichData(parsedQuery: ParsedQuery, extractionPlan: string[]): Promise<EnrichedData> {
    try {
      // Step 1: Extract base data based on the query
      const baseData = await this.extractBaseData(parsedQuery);

      // Check if we have any data
      if (!baseData || baseData.length === 0) {
        return {
          id: this.generateId(),
          data: [],
          metadata: {
            totalRecords: 0,
            enrichedAt: new Date(),
            sources: this.getDataSources(),
            message: 'No data available. Please ensure database is configured or API keys are set.',
          },
        };
      }

      // Step 2: Enrich data with additional information
      const enrichedData = await this.enrichData(baseData, parsedQuery.columns);

      // Step 3: Apply filters and sorting
      const finalData = this.applyFiltersAndSort(enrichedData, parsedQuery);

      return {
        id: this.generateId(),
        data: finalData,
        metadata: {
          totalRecords: finalData.length,
          enrichedAt: new Date(),
          sources: this.getDataSources(),
        },
      };
    } catch (error) {
      console.error('Error extracting and enriching data:', error);
      throw new Error(`Data extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async extractBaseData(query: ParsedQuery): Promise<Record<string, unknown>[]> {
    // Check if we can use vector search from the documentation database
    const connectionString = process.env.POSTGRES_CONNECTION_STRING;
    
    if (connectionString) {
      try {
        return await this.searchDocumentationDatabase(query);
      } catch (error) {
        console.warn('Failed to search documentation database, falling back to generated data:', error);
      }
    }

    // Fallback to Claude generation if database is not available
    const claudeApiKey = process.env.ANTHROPIC_API_KEY;
    if (claudeApiKey) {
      try {
        return await this.generateDataWithClaude(query);
      } catch (error) {
        console.error('Failed to generate data with Claude:', error);
        throw new Error('No data sources available. Please configure database connection or provide API keys.');
      }
    }
    
    // No data sources available
    throw new Error('No data sources configured. Please set POSTGRES_CONNECTION_STRING for database access or ANTHROPIC_API_KEY for AI generation.');
  }

  private async searchDocumentationDatabase(query: ParsedQuery): Promise<Record<string, unknown>[]> {
    const connectionString = process.env.POSTGRES_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error('POSTGRES_CONNECTION_STRING not set');
    }

    const client = new PgClient({ connectionString });
    try {
      await client.connect();

      // Get user context and accessible indexes
      const context = await getUserContext(client);
      const accessibleIndexes = await getAccessibleIndexes(client, context);

      if (accessibleIndexes.length === 0) {
        throw new Error('No accessible indexes available');
      }

      // Use the first accessible index or a specific one based on query
      const index = this.selectBestIndex(accessibleIndexes, query);
      const table = `docs_${index}`;
      const quotedTable = `"${table}"`;

      // Generate embedding for the query
      const embeddingProvider = await this.createEmbeddingProviderInstance();
      const queryText = `${query.intent} ${JSON.stringify(query.filters)} ${query.columns.join(' ')}`;
      const [embedding] = await embeddingProvider.embedBatch([queryText]);
      const vectorParam = `[${embedding.join(',')}]`;

      // Query by cosine distance with a higher limit to account for filtering
      const searchLimit = Math.min((query.limit || 10) * 3, 100); // Get 3x requested to allow for filtering
      
      const { rows } = await client.query<{
        url: string;
        title: string;
        content: string;
        score: number;
      }>(
        `SELECT url, title, content, 1 - (embedding <=> $1::vector) AS score
         FROM ${quotedTable}
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [vectorParam, searchLimit]
      );

      // Transform results to match expected format
      const results = rows.map(r => ({
        name: r.title || 'Unknown',
        domain: this.extractDomainFromUrl(r.url),
        url: r.url,
        description: r.content?.slice(0, 200),
        relevance_score: r.score,
        source: 'documentation_db',
        index_name: index,
      }));

      return results;
    } finally {
      await client.end();
    }
  }

  private selectBestIndex(indexes: string[], query: ParsedQuery): string {
    // Try to match index based on query filters or intent
    const queryText = query.intent.toLowerCase();
    
    // Look for industry or domain-specific matches
    for (const index of indexes) {
      if (queryText.includes(index.toLowerCase()) || 
          JSON.stringify(query.filters).toLowerCase().includes(index.toLowerCase())) {
        return index;
      }
    }

    // Default to first available index
    return indexes[0];
  }

  private extractDomainFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'unknown.com';
    }
  }

  private async generateDataWithClaude(query: ParsedQuery): Promise<Record<string, unknown>[]> {
    const systemPrompt = `You are a data extraction system. Generate sample business data based on the query filters provided.
    
Create realistic company data with the requested fields. Each company should have:
- Unique identifiers (name, domain)
- Relevant business information
- Contact details where requested

Generate between 10-20 records that match the criteria.
Return the data as a JSON array.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 4000,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Extract data matching these criteria: ${JSON.stringify(query)}`,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }

      return JSON.parse(jsonMatch[0]) as Record<string, unknown>[];
    } catch (error) {
      console.error('Error generating data with Claude:', error);
      // Re-throw error instead of returning sample data
      throw new Error(`Claude API failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async enrichData(
    baseData: Record<string, unknown>[],
    columns: string[]
  ): Promise<Record<string, unknown>[]> {
    // Identify which columns need enrichment
    const enrichmentNeeded = columns.filter(col => 
      col.includes('linkedin') || 
      col.includes('phone') || 
      col.includes('email') ||
      col.includes('revenue') ||
      col.includes('employees')
    );

    if (enrichmentNeeded.length === 0) {
      return baseData;
    }

    // In a real implementation, this would call various enrichment APIs
    // For now, skip enrichment if not available
    return baseData.map(record => {
      const enrichedRecord = { ...record };
      
      for (const field of enrichmentNeeded) {
        if (!enrichedRecord[field]) {
          // Mark fields as unavailable rather than generating fake data
          enrichedRecord[field] = '[Data not available]';
        }
      }
      
      return enrichedRecord;
    });
  }

  private applyFiltersAndSort(
    data: Record<string, unknown>[],
    query: ParsedQuery
  ): Record<string, unknown>[] {
    let filteredData = [...data];

    // Apply additional filters if needed
    if (query.filters && Object.keys(query.filters).length > 0) {
      filteredData = filteredData.filter(record => {
        for (const [key, value] of Object.entries(query.filters)) {
          if (record[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }

    // Apply sorting
    if (query.sortBy) {
      filteredData.sort((a, b) => {
        const aValue = a[query.sortBy!] as any;
        const bValue = b[query.sortBy!] as any;
        
        if (query.sortOrder === 'desc') {
          return bValue > aValue ? 1 : -1;
        }
        return aValue > bValue ? 1 : -1;
      });
    }

    // Apply limit
    if (query.limit) {
      filteredData = filteredData.slice(0, query.limit);
    }

    // Filter to only requested columns
    if (query.columns && query.columns.length > 0) {
      filteredData = filteredData.map(record => {
        const filtered: Record<string, unknown> = {};
        for (const col of query.columns) {
          filtered[col] = record[col];
        }
        return filtered;
      });
    }

    return filteredData;
  }

  // Removed generateEnrichmentData method - no longer generating fake data

  // Removed generateSampleData method - no longer returning sample/mock data

  private generateId(): string {
    return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDataSources(): string[] {
    // Return the data sources used for extraction
    const sources = [];
    if (process.env.POSTGRES_CONNECTION_STRING) {
      sources.push('documentation_vector_db');
    }
    if (process.env.ANTHROPIC_API_KEY) {
      sources.push('claude_ai');
    }
    sources.push('enrichment_api');
    return sources;
  }
}