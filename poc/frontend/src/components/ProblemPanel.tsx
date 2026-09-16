import { isApiProblemError, type ProblemDocument } from '../api/types';

type Props = {
  error: unknown;
  title?: string;
};

function asProblem(error: unknown): ProblemDocument | null {
  if (isApiProblemError(error)) return error.problem;
  return null;
}

const PROBLEM_TITLES: Record<string, string> = {
  unauthenticated: 'A munkamenet érvénytelen',
  forbidden: 'Nincs jogosultság',
  content_not_found: 'A tartalom nem található',
  content_not_editable: 'A publikált tartalom nem szerkeszthető',
  content_already_published: 'A tartalom már publikált',
  content_not_published: 'A tartalom nincs publikált állapotban',
  slug_conflict: 'A slug már használatban van',
  version_conflict: 'A tartalom időközben megváltozott',
  payload_too_large: 'A kérés túl nagy',
  validation_failed: 'Ellenőrizd a megadott mezőket',
  dependency_unavailable: 'Egy háttérszolgáltatás nem elérhető',
  search_unavailable: 'A keresés jelenleg nem elérhető',
};

export function ProblemPanel({ error, title = 'API hiba' }: Props) {
  if (!error) return null;

  const problem = asProblem(error);
  if (!problem) {
    return (
      <aside className="panel panel-error" aria-live="polite">
        <h3>{title}</h3>
        <p className="mono">{error instanceof Error ? error.message : String(error)}</p>
      </aside>
    );
  }

  return (
    <aside className="panel panel-error" aria-live="polite">
      <h3>{PROBLEM_TITLES[problem.code] ?? title}</h3>
      <dl className="kv">
        <div>
          <dt>code</dt>
          <dd className="mono">{problem.code}</dd>
        </div>
        <div>
          <dt>status</dt>
          <dd className="mono">{problem.status}</dd>
        </div>
        <div>
          <dt>detail</dt>
          <dd>{problem.detail}</dd>
        </div>
        <div>
          <dt>correlationId</dt>
          <dd className="mono">
            {problem.correlationId || '—'}{' '}
            {problem.correlationId ? (
              <button
                type="button"
                className="copy-button"
                onClick={() => void navigator.clipboard?.writeText(problem.correlationId)}
              >
                Másolás
              </button>
            ) : null}
          </dd>
        </div>
        {problem.fields && problem.fields.length > 0 ? (
          <div>
            <dt>fields</dt>
            <dd className="mono">{problem.fields.join(', ')}</dd>
          </div>
        ) : null}
        {problem.expectedVersion !== undefined ? (
          <div>
            <dt>expectedVersion</dt>
            <dd className="mono">{problem.expectedVersion}</dd>
          </div>
        ) : null}
        {problem.actualVersion !== undefined ? (
          <div>
            <dt>actualVersion</dt>
            <dd className="mono">{problem.actualVersion}</dd>
          </div>
        ) : null}
      </dl>
      <details>
        <summary>Technikai részletek</summary>
        <pre className="json top-gap">{JSON.stringify(problem, null, 2)}</pre>
      </details>
    </aside>
  );
}
