import { http, HttpResponse } from 'msw';
import {
  emptySearchFixture, processingFixture, publisherFixture,
} from './fixtures/api';

export const handlers = [
  http.get('*/api/me', () => HttpResponse.json(publisherFixture, {
    headers: { 'X-Correlation-Id': 'test-me' },
  })),
  http.get('*/api/catalog/search', () => HttpResponse.json(emptySearchFixture, {
    headers: { 'X-Correlation-Id': 'test-search' },
  })),
  http.get('*/api/admin/processing-status', () => HttpResponse.json(processingFixture, {
    headers: { 'X-Correlation-Id': 'test-processing' },
  })),
];
