import { QueryAPIRouter } from './routes';
import { Router } from 'express';

export function createQueryAPIModule(): { router: Router } {
  const queryAPI = new QueryAPIRouter();
  return {
    router: queryAPI.getRouter(),
  };
}

export * from './types';
export * from './query-planner';
export * from './data-extractor';
export * from './destinations';
export * from './temporal/workflows';
export * from './temporal/activities';