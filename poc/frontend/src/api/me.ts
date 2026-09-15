import { apiRequest } from './client';
import type { MeResponse } from './types';

export function fetchMe(accessToken: string) {
  return apiRequest<MeResponse>('/me', { accessToken });
}
