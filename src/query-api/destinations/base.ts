import { EnrichedData, DestinationType } from '../types';

export abstract class BaseDestination {
  abstract type: DestinationType;
  abstract config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    this.config = config;
  }

  abstract send(data: EnrichedData): Promise<{ success: boolean; url?: string; error?: string }>;

  protected validateConfig(): void {
    if (!this.config || Object.keys(this.config).length === 0) {
      throw new Error(`Invalid configuration for ${this.type} destination`);
    }
  }
}