import axios from 'axios';
import { BaseDestination } from './base';
import { EnrichedData, DestinationType } from '../types';

export class URLDestination extends BaseDestination {
  type: DestinationType = 'URL';

  async send(data: EnrichedData): Promise<{ success: boolean; url?: string; error?: string }> {
    this.validateConfig();

    const endpoint = this.config.endpoint as string;
    const headers = (this.config.headers || {}) as Record<string, string>;

    if (!endpoint) {
      return { success: false, error: 'URL endpoint is required' };
    }

    // Check if there's no data to send
    if (!data.data || data.data.length === 0) {
      return {
        success: false,
        error: data.metadata.message || 'No data available to send',
      };
    }

    try {
      const response = await axios.post(endpoint, data, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        timeout: 30000,
      });

      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          url: endpoint,
        };
      } else {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error) {
      console.error('Error sending data to URL:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send data to URL',
      };
    }
  }
}