import { QueryPlanner } from '../query-planner';
import { DataExtractor } from '../data-extractor';
import { DestinationFactory } from '../destinations';
import { EnrichedData, DestinationType } from '../types';

export async function processQueryActivity(
  query: string,
  columns?: string[]
): Promise<EnrichedData> {
  const planner = new QueryPlanner();
  const extractor = new DataExtractor();

  // Parse and plan the query
  const parsedQuery = await planner.parseAndPlanQuery(query);
  
  // Override columns if specified
  if (columns && columns.length > 0) {
    parsedQuery.columns = columns;
  }

  // Generate extraction plan
  const extractionPlan = await planner.generateDataExtractionPlan(parsedQuery);

  // Extract and enrich data
  const enrichedData = await extractor.extractAndEnrichData(parsedQuery, extractionPlan);

  return enrichedData;
}

export async function sendToDestinationActivity(
  data: EnrichedData,
  destination: { type: DestinationType; config: Record<string, unknown> }
): Promise<{ success: boolean; url?: string; error?: string }> {
  const destinationHandler = DestinationFactory.create(destination.type, destination.config);
  return await destinationHandler.send(data);
}