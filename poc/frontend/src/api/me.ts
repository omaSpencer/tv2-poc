import { apiRequest } from './client';
import type { MeResponse } from './types';

export function fetchMe() {
  return apiRequest<MeResponse>('/me', { retryAuth: false });
}
