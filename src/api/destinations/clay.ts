import axios from 'axios';
import { BaseDestination } from './base';
import { EnrichedData, DestinationType } from '../types';

export class ClayDestination extends BaseDestination {
  type: DestinationType = 'Clay';
  private readonly CLAY_API_BASE = 'https://api.clay.com/v1';

  async send(data: EnrichedData): Promise<{ success: boolean; url?: string; error?: string }> {
    this.validateConfig();

    const apiKey = this.config.apiKey as string;
    const tableId = this.config.tableId as string;

    if (!apiKey || !tableId) {
      return {
        success: false,
        error: 'Clay configuration requires apiKey and tableId',
      };
    }

    // Check if there's no data to send
    if (!data.data || data.data.length === 0) {
      return {
        success: false,
        error: data.metadata.message || 'No data available to send',
      };
    }

    try {
      // Clay API expects data in a specific format
      const clayData = this.formatDataForClay(data);
      
      // Send data to Clay table
      const response = await axios.post(
        `${this.CLAY_API_BASE}/tables/${tableId}/rows`,
        {
          rows: clayData,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status === 200 || response.status === 201) {
        const clayUrl = `https://app.clay.com/workspaces/tables/${tableId}`;
        return {
          success: true,
          url: clayUrl,
        };
      } else {
        return {
          success: false,
          error: `Clay API error: ${response.status}`,
        };
      }
    } catch (error) {
      console.error('Error sending data to Clay:', error);
      if (axios.isAxiosError(error) && error.response) {
        return {
          success: false,
          error: `Clay API error: ${error.response.status} - ${error.response.data?.message || error.message}`,
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send data to Clay',
      };
    }
  }

  private formatDataForClay(data: EnrichedData): Record<string, unknown>[] {
    // Clay expects flat objects with string keys
    return data.data.map(item => {
      const flatItem: Record<string, unknown> = {};
      
      for (const [key, value] of Object.entries(item)) {
        // Clay prefers flat structures, so we'll stringify nested objects
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          // Flatten nested objects
          for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
            flatItem[`${key}_${nestedKey}`] = nestedValue;
          }
        } else if (Array.isArray(value)) {
          // Join arrays as comma-separated strings
          flatItem[key] = value.join(', ');
        } else {
          flatItem[key] = value;
        }
      }
      
      return flatItem;
    });
  }
}