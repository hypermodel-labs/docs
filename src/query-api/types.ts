export type DestinationType = 'URL' | 'Snowflake' | 'Sheets' | 'Clay';

export interface QueryRequest {
  query: string;
  destination: {
    type: DestinationType;
    config: Record<string, unknown>;
  };
  columns?: string[];
}

export interface QueryResponse {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  destination: {
    type: DestinationType;
    url?: string;
  };
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedQuery {
  intent: string;
  filters: Record<string, unknown>;
  columns: string[];
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface EnrichedData {
  id: string;
  data: Record<string, unknown>[];
  metadata: {
    totalRecords: number;
    enrichedAt: Date;
    sources: string[];
  };
}

export interface DestinationConfig {
  url?: {
    endpoint: string;
    headers?: Record<string, string>;
  };
  snowflake?: {
    account: string;
    database: string;
    schema: string;
    table: string;
    warehouse: string;
    credentials: {
      username: string;
      password: string;
    };
  };
  sheets?: {
    spreadsheetId: string;
    sheetName: string;
    credentials: {
      accessToken: string;
    };
  };
  clay?: {
    apiKey: string;
    tableId: string;
  };
}