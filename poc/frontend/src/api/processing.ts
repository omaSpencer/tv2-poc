import { apiRequest } from './client';
import type { ProcessingStatus } from './types';

export function fetchProcessingStatus(accessToken: string) {
  return apiRequest<ProcessingStatus>('/admin/processing-status', { accessToken });
}
