import { BaseDestination } from './base';
import { URLDestination } from './url';
import { SnowflakeDestination } from './snowflake';
import { SheetsDestination } from './sheets';
import { ClayDestination } from './clay';
import { DestinationType } from '../types';

export class DestinationFactory {
  static create(type: DestinationType, config: Record<string, unknown>): BaseDestination {
    switch (type) {
      case 'URL':
        return new URLDestination(config);
      case 'Snowflake':
        return new SnowflakeDestination(config);
      case 'Sheets':
        return new SheetsDestination(config);
      case 'Clay':
        return new ClayDestination(config);
      default:
        throw new Error(`Unsupported destination type: ${type}`);
    }
  }
}

export { BaseDestination, URLDestination, SnowflakeDestination, SheetsDestination, ClayDestination };