import { query } from '@anthropic-ai/claude-code';
import { ParsedQuery } from './types';

export class QueryPlanner {
  constructor() {
    // Claude Code SDK uses environment variables automatically
  }

  async parseAndPlanQuery(queryString: string): Promise<ParsedQuery> {
    const prompt = `You are a data query parser and planner. Your job is to parse natural language queries about business datasets and extract structured information.

Extract the following from the user's query:
1. Intent: What type of data they're looking for
2. Filters: Specific criteria (e.g., funding round, industry, location)
3. Columns: What fields they want in the response
4. Limit: How many records (if specified)
5. Sort: How to order results (if specified)

User Query: ${queryString}

Return your response as a valid JSON object with these keys:
{
  "intent": "string describing the main goal",
  "filters": { "key": "value" },
  "columns": ["column1", "column2"],
  "limit": number or null,
  "sortBy": "column_name" or null,
  "sortOrder": "asc" or "desc" or null
}

Provide ONLY the JSON object, no additional text.`;

    try {
      const response = await query({
        prompt,
        options: {
          maxTurns: 1,
        }
      });

      // Collect the full response
      let fullResponse = '';
      for await (const message of response) {
        if (message.type === 'text') {
          fullResponse += message.text;
        }
      }

      // Parse the JSON response
      const parsedResponse = JSON.parse(fullResponse);
      
      const parsedQuery: ParsedQuery = {
        intent: parsedResponse.intent || '',
        filters: parsedResponse.filters || {},
        columns: parsedResponse.columns || [],
        limit: parsedResponse.limit || null,
        sortBy: parsedResponse.sortBy || null,
        sortOrder: parsedResponse.sortOrder || null,
      };
      
      return parsedQuery;
    } catch (error) {
      console.error('Error parsing query with Claude:', error);
      throw new Error(`Failed to parse query: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async generateDataExtractionPlan(parsedQuery: ParsedQuery): Promise<string[]> {
    const prompt = `You are a data extraction planner. Given a parsed query, generate a step-by-step plan to extract and enrich the requested data.

Consider:
1. What data sources to query
2. What enrichment steps are needed (e.g., finding LinkedIn profiles, phone numbers)
3. How to filter and transform the data
4. The order of operations for efficiency

Parsed Query: ${JSON.stringify(parsedQuery, null, 2)}

Return a JSON array of step descriptions. Provide ONLY the JSON array, no additional text.`;

    try {
      const response = await query({
        prompt,
        options: {
          maxTurns: 1,
        }
      });

      // Collect the full response
      let fullResponse = '';
      for await (const message of response) {
        if (message.type === 'text') {
          fullResponse += message.text;
        }
      }

      // Parse the JSON array response
      const steps = JSON.parse(fullResponse);
      
      if (!Array.isArray(steps)) {
        throw new Error('Expected an array of steps');
      }
      
      return steps;
    } catch (error) {
      console.error('Error generating extraction plan:', error);
      throw new Error(`Failed to generate extraction plan: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}