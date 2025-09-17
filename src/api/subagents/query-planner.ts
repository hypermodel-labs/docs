import { Anthropic } from '@anthropic-ai/sdk';
import type { QueryPlan, QueryStep } from '../data-query/types';

export class QueryPlannerAgent {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async createPlan(query: string, columns: string[]): Promise<QueryPlan> {
    const systemPrompt = `You are a data query planning specialist. Your job is to analyze natural language queries and create execution plans for data extraction and enrichment.

You have access to the following tools:
- Web search for finding companies and organizations
- Data extraction from websites
- LinkedIn profile enrichment
- Email/phone number discovery
- Company information enrichment

Return a JSON object with the following structure:
{
  "steps": [
    {
      "type": "search" | "extract" | "enrich" | "transform" | "export",
      "description": "Clear description of what this step does",
      "tool": "Name of the tool to use (optional)",
      "parameters": { ... }
    }
  ],
  "estimatedTime": <seconds>,
  "dataSource": "Primary data source identified"
}`;

    const userPrompt = `Create an execution plan for this query:
Query: ${query}
Required columns: ${columns.join(', ')}

Consider the best approach to:
1. Find the requested data
2. Extract the required fields
3. Enrich with additional information if needed
4. Format for the specified columns`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        temperature: 0.2,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]) as QueryPlan;
        }
      }

      return this.getDefaultPlan(query, columns);
    } catch (error) {
      console.error('Error creating query plan:', error);
      return this.getDefaultPlan(query, columns);
    }
  }

  private getDefaultPlan(query: string, columns: string[]): QueryPlan {
    return {
      steps: [
        {
          type: 'search',
          description: 'Search for relevant data sources',
          tool: 'web_search',
          parameters: { query },
        },
        {
          type: 'extract',
          description: 'Extract required fields from sources',
          tool: 'data_extractor',
          parameters: { fields: columns },
        },
        {
          type: 'enrich',
          description: 'Enrich data with additional information',
          tool: 'enrichment_engine',
        },
        {
          type: 'export',
          description: 'Export to destination',
        },
      ],
      estimatedTime: 60,
      dataSource: 'web_search',
    };
  }
}