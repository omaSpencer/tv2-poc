import { isApiProblemError, type ProblemDocument } from '../api/types';

type Props = {
  error: unknown;
  title?: string;
};

function asProblem(error: unknown): ProblemDocument | null {
  if (isApiProblemError(error)) return error.problem;
  return null;
}

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
      <h3>{title}</h3>
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
          <dd className="mono">{problem.correlationId || '—'}</dd>
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
      <pre className="json">{JSON.stringify(problem, null, 2)}</pre>
    </aside>
  );
}
