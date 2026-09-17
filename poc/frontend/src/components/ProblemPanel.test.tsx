import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProblemError, type ProblemDocument } from '../api/types';
import { ProblemPanel } from './ProblemPanel';

function error(status: number, code: ProblemDocument['code'], extras: Partial<ProblemDocument> = {}) {
  const problem: ProblemDocument = {
    type: `urn:test:${code}`, title: code, status, code, detail: 'Biztonságos részlet.',
    instance: '/test', correlationId: `corr-${code}`, ...extras,
  };
  return new ApiProblemError(problem, problem.correlationId);
}

describe('ProblemPanel state matrix', () => {
  it.each([
    [403, 'forbidden', 'Nincs jogosultság'],
    [404, 'content_not_found', 'A tartalom nem található'],
    [409, 'content_not_editable', 'A publikált tartalom nem szerkeszthető'],
    [413, 'payload_too_large', 'A kérés túl nagy'],
    [422, 'validation_failed', 'Ellenőrizd a megadott mezőket'],
    [503, 'search_unavailable', 'A keresés jelenleg nem elérhető'],
  ] as const)('renders HTTP %s %s distinctly', (status, code, heading) => {
    render(<ProblemPanel error={error(status, code)} />);
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    expect(screen.getByText(String(status))).toBeTruthy();
    expect(screen.getAllByText(code).length).toBeGreaterThan(0);
  });

  it('shows exact validation fields and version conflict values', () => {
    const { rerender } = render(<ProblemPanel error={error(422, 'validation_failed', { fields: ['title', 'mediaAssetId'] })} />);
    expect(screen.getByText('title, mediaAssetId')).toBeTruthy();
    rerender(<ProblemPanel error={error(409, 'version_conflict', { expectedVersion: 3, actualVersion: 4 })} />);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('keeps a network error separate from an API problem', () => {
    render(<ProblemPanel error={new TypeError('Failed to fetch')} title="Kapcsolati hiba" />);
    expect(screen.getByRole('heading', { name: 'Kapcsolati hiba' })).toBeTruthy();
    expect(screen.getByText('Failed to fetch')).toBeTruthy();
    expect(screen.queryByText('correlationId')).toBeNull();
  });
});
