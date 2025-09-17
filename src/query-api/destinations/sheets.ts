import axios from 'axios';
import { BaseDestination } from './base';
import { EnrichedData, DestinationType } from '../types';

export class SheetsDestination extends BaseDestination {
  type: DestinationType = 'Sheets';

  async send(data: EnrichedData): Promise<{ success: boolean; url?: string; error?: string }> {
    this.validateConfig();

    const spreadsheetId = this.config.spreadsheetId as string;
    const sheetName = this.config.sheetName as string;
    const accessToken = this.config.accessToken as string;

    if (!spreadsheetId || !sheetName || !accessToken) {
      return { 
        success: false, 
        error: 'Sheets configuration requires spreadsheetId, sheetName, and accessToken' 
      };
    }

    try {
      // Prepare data for Google Sheets
      const rows = this.formatDataForSheets(data);
      
      // Use Google Sheets API to append data
      const range = `${sheetName}!A1`;
      const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append`;
      
      const response = await axios.post(
        apiUrl,
        {
          range,
          majorDimension: 'ROWS',
          values: rows,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          params: {
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS',
          },
        }
      );

      if (response.status === 200) {
        const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;
        return {
          success: true,
          url: spreadsheetUrl,
        };
      } else {
        return {
          success: false,
          error: `Google Sheets API error: ${response.status}`,
        };
      }
    } catch (error) {
      console.error('Error sending data to Google Sheets:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send data to Google Sheets',
      };
    }
  }

  private formatDataForSheets(data: EnrichedData): unknown[][] {
    if (!data.data || data.data.length === 0) {
      return [];
    }

    // Extract headers from the first data item
    const headers = Object.keys(data.data[0]);
    
    // Create rows array with headers as the first row
    const rows: unknown[][] = [headers];
    
    // Add data rows
    for (const item of data.data) {
      const row = headers.map(header => {
        const value = item[header];
        // Handle nested objects and arrays
        if (typeof value === 'object' && value !== null) {
          return JSON.stringify(value);
        }
        return value ?? '';
      });
      rows.push(row);
    }

    return rows;
  }
}