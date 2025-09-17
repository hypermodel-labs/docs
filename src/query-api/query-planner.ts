import Anthropic from '@anthropic-ai/sdk';
import { ParsedQuery } from './types';

export class QueryPlanner {
  private anthropic: Anthropic;

  constructor(apiKey?: string) {
    this.anthropic = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async parseAndPlanQuery(query: string): Promise<ParsedQuery> {
    const systemPrompt = `You are a data query parser and planner. Your job is to parse natural language queries about business datasets and extract structured information.

Extract the following from the user's query:
1. Intent: What type of data they're looking for
2. Filters: Specific criteria (e.g., funding round, industry, location)
3. Columns: What fields they want in the response
4. Limit: How many records (if specified)
5. Sort: How to order results (if specified)

Return your response as a valid JSON object with these keys:
{
  "intent": "string describing the main goal",
  "filters": { "key": "value" },
  "columns": ["column1", "column2"],
  "limit": number or null,
  "sortBy": "column_name" or null,
  "sortOrder": "asc" or "desc" or null
}`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 1000,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: query,
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in Claude response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as ParsedQuery;
      return parsed;
    } catch (error) {
      console.error('Error parsing query with Claude:', error);
      throw new Error(`Failed to parse query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateDataExtractionPlan(parsedQuery: ParsedQuery): Promise<string[]> {
    const systemPrompt = `You are a data extraction planner. Given a parsed query, generate a step-by-step plan to extract and enrich the requested data.

Consider:
1. What data sources to query
2. What enrichment steps are needed (e.g., finding LinkedIn profiles, phone numbers)
3. How to filter and transform the data
4. The order of operations for efficiency

Return a JSON array of step descriptions.`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-5-sonnet-latest',
        max_tokens: 1000,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: JSON.stringify(parsedQuery),
          },
        ],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Claude');
      }

      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in Claude response');
      }

      return JSON.parse(jsonMatch[0]) as string[];
    } catch (error) {
      console.error('Error generating extraction plan:', error);
      throw new Error(`Failed to generate extraction plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}