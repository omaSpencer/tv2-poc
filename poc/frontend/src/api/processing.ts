import { apiRequest } from './client';
import type { ProcessingStatus } from './types';

export function fetchProcessingStatus() {
  return apiRequest<ProcessingStatus>('/admin/processing-status');
}
