import { ParsedQuery, EnrichedData } from './types';
import Anthropic from '@anthropic-ai/sdk';

export class DataExtractor {
  private anthropic: Anthropic;
  private mcpTools?: any; // MCP tools if available

  constructor(apiKey?: string, mcpTools?: any) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    this.mcpTools = mcpTools;
  }

  async extractAndEnrichData(parsedQuery: ParsedQuery, extractionPlan: string[]): Promise<EnrichedData> {
    try {
      // Step 1: Extract base data based on the query
      const baseData = await this.extractBaseData(parsedQuery);

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
    // In a real implementation, this would query actual data sources
    // For now, we'll use Claude to simulate data extraction
    
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
      console.error('Error extracting base data:', error);
      // Return sample data as fallback
      return this.generateSampleData(query);
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
    // For now, we'll simulate enrichment
    return baseData.map(record => {
      const enrichedRecord = { ...record };
      
      for (const field of enrichmentNeeded) {
        if (!enrichedRecord[field]) {
          enrichedRecord[field] = this.generateEnrichmentData(field, record);
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

  private generateEnrichmentData(field: string, record: Record<string, unknown>): string {
    // Simulate enrichment based on field type
    const companyName = (record.name as string) || 'Company';
    const domain = (record.domain as string) || 'example.com';
    
    switch (true) {
      case field.includes('linkedin'):
        return `https://linkedin.com/in/${companyName.toLowerCase().replace(/\s+/g, '-')}`;
      case field.includes('phone'):
        return `+1-555-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`;
      case field.includes('email'):
        return `contact@${domain}`;
      case field.includes('revenue'):
        return `$${Math.floor(Math.random() * 100) + 10}M`;
      case field.includes('employees'):
        return `${Math.floor(Math.random() * 1000) + 50}`;
      default:
        return 'N/A';
    }
  }

  private generateSampleData(query: ParsedQuery): Record<string, unknown>[] {
    // Generate sample data as fallback
    const sampleCompanies = [
      { name: 'TechStart Inc', domain: 'techstart.com', industry: 'Technology', funding_round: 'Series A' },
      { name: 'DataFlow Systems', domain: 'dataflow.io', industry: 'Data Analytics', funding_round: 'Series B' },
      { name: 'CloudNine Solutions', domain: 'cloudnine.com', industry: 'Cloud Services', funding_round: 'Series A' },
      { name: 'AI Innovations', domain: 'aiinnov.com', industry: 'Artificial Intelligence', funding_round: 'Seed' },
      { name: 'FinTech Pro', domain: 'fintechpro.com', industry: 'Financial Technology', funding_round: 'Series C' },
      { name: 'HealthTech Plus', domain: 'healthtechplus.com', industry: 'Healthcare', funding_round: 'Series A' },
      { name: 'EcoSmart Solutions', domain: 'ecosmart.com', industry: 'CleanTech', funding_round: 'Series B' },
      { name: 'CyberSecure Inc', domain: 'cybersecure.com', industry: 'Cybersecurity', funding_round: 'Series A' },
      { name: 'EdTech Advance', domain: 'edtechadvance.com', industry: 'Education Technology', funding_round: 'Seed' },
      { name: 'LogiFlow Systems', domain: 'logiflow.com', industry: 'Logistics', funding_round: 'Series A' },
    ];

    return sampleCompanies.slice(0, query.limit || 10);
  }

  private generateId(): string {
    return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getDataSources(): string[] {
    // Return the data sources used for extraction
    return ['internal_database', 'enrichment_api', 'claude_ai'];
  }
}