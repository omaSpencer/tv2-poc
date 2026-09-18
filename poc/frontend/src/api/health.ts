import { apiRequest } from './client';
import type { HealthBody } from './types';

export async function fetchLive() {
  return apiRequest<HealthBody>('/health/live', { auth: false });
}

/** Ready may return 503 with Terminus-shaped JSON (not problem+json). */
export async function fetchReady() {
  return apiRequest<HealthBody>('/health/ready', { auth: false, acceptNonOkJson: true });
}
