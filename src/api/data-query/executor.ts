import { QueryPlannerAgent } from '../subagents/query-planner';
import { EnrichmentAgent } from '../subagents/enrichment-agent';
import type { DataQueryRequest, QueryPlan } from './types';
import { v4 as uuidv4 } from 'crypto';

export class QueryExecutor {
  private planner: QueryPlannerAgent;
  private enricher: EnrichmentAgent;
  private jobs: Map<string, JobStatus>;

  constructor() {
    this.planner = new QueryPlannerAgent();
    this.enricher = new EnrichmentAgent();
    this.jobs = new Map();
  }

  async executeQuery(request: DataQueryRequest): Promise<string> {
    const jobId = uuidv4();

    this.jobs.set(jobId, {
      id: jobId,
      status: 'pending',
      request,
      createdAt: Date.now(),
    });

    this.processQueryAsync(jobId, request);

    return jobId;
  }

  private async processQueryAsync(jobId: string, request: DataQueryRequest): Promise<void> {
    try {
      this.updateJobStatus(jobId, 'processing');

      const plan = await this.planner.createPlan(request.query, request.columns);

      const data = await this.executePlan(plan, request);

      await this.exportData(data, request.destination);

      this.updateJobStatus(jobId, 'completed', { data, exportedAt: Date.now() });
    } catch (error) {
      console.error(`Job ${jobId} failed:`, error);
      this.updateJobStatus(jobId, 'failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  private async executePlan(plan: QueryPlan, request: DataQueryRequest): Promise<any[]> {
    const results: any[] = [];

    for (const step of plan.steps) {
      switch (step.type) {
        case 'search':
          const searchResults = await this.performSearch(step.parameters?.query || request.query);
          results.push(...searchResults);
          break;

        case 'extract':
          const extractedData = await this.extractData(results, request.columns);
          results.length = 0;
          results.push(...extractedData);
          break;

        case 'enrich':
          const enrichmentLevel = request.options?.enrichmentLevel || 'standard';
          const enrichedResults = await this.enrichData(results, request.columns, enrichmentLevel);
          results.length = 0;
          results.push(...enrichedResults);
          break;

        case 'transform':
          const transformedData = this.transformData(results, request.columns);
          results.length = 0;
          results.push(...transformedData);
          break;
      }
    }

    const maxRows = request.options?.maxRows || 100;
    return results.slice(0, maxRows);
  }

  private async performSearch(query: string): Promise<any[]> {
    const mockData = [];
    const searchTerms = query.toLowerCase();

    if (searchTerms.includes('series a') || searchTerms.includes('startup')) {
      mockData.push(
        {
          name: 'TechStart Inc',
          domain: 'techstart.com',
          funding_round: 'Series A',
          industry: 'Technology',
        },
        {
          name: 'DataFlow',
          domain: 'dataflow.io',
          funding_round: 'Series A',
          industry: 'Data Analytics',
        },
        {
          name: 'CloudNext',
          domain: 'cloudnext.com',
          funding_round: 'Series A',
          industry: 'Cloud Computing',
        }
      );
    }

    if (searchTerms.includes('hospitality')) {
      mockData.forEach(item => {
        item.target_industry = 'Hospitality';
      });
    }

    return mockData;
  }

  private async extractData(data: any[], columns: string[]): Promise<any[]> {
    return data.map(item => {
      const extracted: Record<string, any> = {};
      for (const column of columns) {
        extracted[column] = item[column] || null;
      }
      return extracted;
    });
  }

  private async enrichData(data: any[], columns: string[], level: string): Promise<any[]> {
    const enrichmentPromises = data.map(async (item) => {
      const fieldsToEnrich = columns.filter(col => !item[col] || item[col] === null);
      
      if (fieldsToEnrich.length === 0) return item;

      const enrichmentResult = await this.enricher.enrichData(item, fieldsToEnrich);
      return enrichmentResult.enrichedData;
    });

    return Promise.all(enrichmentPromises);
  }

  private transformData(data: any[], columns: string[]): any[] {
    return data.map(item => {
      const transformed: Record<string, any> = {};
      for (const column of columns) {
        transformed[column] = item[column] || null;
      }
      return transformed;
    });
  }

  private async exportData(data: any[], destination: DataQueryRequest['destination']): Promise<void> {
    const exporter = await this.getExporter(destination.type);
    await exporter.export(data, destination.config);
  }

  private async getExporter(type: string): Promise<DataExporter> {
    switch (type) {
      case 'url':
        return new URLExporter();
      case 'snowflake':
        return new SnowflakeExporter();
      case 'sheets':
        return new GoogleSheetsExporter();
      case 'clay':
        return new ClayExporter();
      default:
        throw new Error(`Unsupported destination type: ${type}`);
    }
  }

  private updateJobStatus(jobId: string, status: string, metadata?: any): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      job.metadata = { ...job.metadata, ...metadata };
      job.updatedAt = Date.now();
    }
  }

  getJobStatus(jobId: string): JobStatus | undefined {
    return this.jobs.get(jobId);
  }
}

interface JobStatus {
  id: string;
  status: string;
  request: DataQueryRequest;
  createdAt: number;
  updatedAt?: number;
  metadata?: any;
}

abstract class DataExporter {
  abstract export(data: any[], config: Record<string, any>): Promise<void>;
}

class URLExporter extends DataExporter {
  async export(data: any[], config: Record<string, any>): Promise<void> {
    const axios = (await import('axios')).default;
    await axios.post(config.url, data, {
      headers: config.headers || {},
    });
  }
}

class SnowflakeExporter extends DataExporter {
  async export(data: any[], config: Record<string, any>): Promise<void> {
    console.log('Exporting to Snowflake:', config.table);
  }
}

class GoogleSheetsExporter extends DataExporter {
  async export(data: any[], config: Record<string, any>): Promise<void> {
    console.log('Exporting to Google Sheets:', config.spreadsheetId);
  }
}

class ClayExporter extends DataExporter {
  async export(data: any[], config: Record<string, any>): Promise<void> {
    const axios = (await import('axios')).default;
    await axios.post('https://api.clay.com/v1/data/import', {
      table_id: config.tableId,
      data: data,
    }, {
      headers: {
        'Authorization': `Bearer ${config.apiKey || process.env.CLAY_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  }
}