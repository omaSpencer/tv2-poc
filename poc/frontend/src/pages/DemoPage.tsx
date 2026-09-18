import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/authContext';
import { advanceRun, createRun, runPreflight } from '../features/demo/engine';
import { downloadEvidence, evidenceJson, evidenceMarkdown } from '../features/demo/export';
import {
  clearPersistedRun, fingerprintSubject, loadPersistedRun, persistRun,
} from '../features/demo/persistence';
import { getScenario, SCENARIOS } from '../features/demo/registry';
import type { SafeRunContext, ScenarioId } from '../features/demo/types';

const STATUS_LABELS: Record<SafeRunContext['status'], string> = {
  running: 'Fut', waiting_manual: 'Kézi lépésre vár', passed: 'Sikeres', failed: 'Sikertelen',
  cancelled: 'Megszakítva', inconclusive: 'Nem eldönthető',
};

function stateLabel(state: SafeRunContext['steps'][number]['state']): string {
  return {
    pending: 'Várakozik', running: 'Fut', passed: 'Siker', failed: 'Hiba', manual: 'Kézi lépés', inconclusive: 'Nem eldönthető',
  }[state];
}

export function DemoPage() {
  const { me, isAuthenticated } = useAuth();
  const [selectedId, setSelectedId] = useState<ScenarioId>('S01');
  const [run, setRun] = useState<SafeRunContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const selected = getScenario(selectedId) ?? SCENARIOS[0];

  const acceptRun = useCallback((next: SafeRunContext) => {
    setRun(next);
    persistRun(next);
  }, []);

  useEffect(() => {
    let current = true;
    if (!me) return () => { current = false; };
    void fingerprintSubject(me.sub).then((hash) => {
      if (!current) return;
      const restored = loadPersistedRun(hash);
      if (restored) {
        setSelectedId(restored.scenarioId);
        setRun(restored);
        persistRun(restored);
      }
    });
    return () => { current = false; };
  }, [me]);

  async function start(): Promise<void> {
    if (!me || !isAuthenticated) {
      setMessage('A forgatókönyv futtatásához bejelentkezett identitás szükséges.');
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setMessage(null);
    const subjectHash = await fingerprintSubject(me.sub);
    const next = createRun(selected, subjectHash, me);
    acceptRun(next);
    const ready = await runPreflight(selected, next, me, acceptRun);
    if (ready) await advanceRun(selected, next, controller.signal, acceptRun);
    setBusy(false);
  }

  async function continueManual(): Promise<void> {
    if (!run || !me) return;
    const definition = getScenario(run.scenarioId);
    if (!definition) return;
    const subjectHash = await fingerprintSubject(me.sub);
    const reattached: SafeRunContext = {
      ...run,
      subjectHash,
      roles: [...me.roles],
      permissions: [...me.permissions],
      steps: run.steps.map((step) => ({ ...step })),
    };
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setMessage(null);
    acceptRun(reattached);
    await advanceRun(definition, reattached, controller.signal, acceptRun, true);
    setBusy(false);
  }

  function clear(): void {
    controllerRef.current?.abort();
    clearPersistedRun();
    setRun(null);
    setBusy(false);
    setMessage(null);
  }

  function exportRun(format: 'json' | 'markdown'): void {
    if (!run) return;
    const definition = getScenario(run.scenarioId);
    if (!definition) return;
    const base = `phase-6-${run.scenarioId.toLowerCase()}-${run.runId}`;
    if (format === 'json') downloadEvidence(`${base}.json`, evidenceJson(definition, run), 'application/json');
    else downloadEvidence(`${base}.md`, evidenceMarkdown(definition, run), 'text/markdown');
  }

  const activeDefinition = run ? getScenario(run.scenarioId) : undefined;
  const hasActiveRun = run?.status === 'running' || run?.status === 'waiting_manual';
  const activeManualStep = run?.status === 'waiting_manual' && activeDefinition
    ? activeDefinition.steps[run.currentStepIndex]
    : null;

  return (
    <div className="stack-pages demo-workspace">
      <section className="panel">
        <p className="eyebrow">Release C · Phase 6</p>
        <h2>Forgatókönyv-futtató és bizonyítéktér</h2>
        <p className="muted">
          Deklaratív, allowlist-alapú futtatás egzakt ellenőrzésekkel. A napló és az export nem tartalmaz tokent,
          headert, teljes request/response body-t vagy felhasználói azonosítót.
        </p>
        <div className="demo-scenario-grid" role="list" aria-label="Forgatókönyvek">
          {SCENARIOS.map((scenario) => (
            <div key={scenario.id} role="listitem">
              <button
                type="button"
                className={`scenario-card${selectedId === scenario.id ? ' selected' : ''}`}
                aria-pressed={selectedId === scenario.id}
                disabled={busy}
                onClick={() => setSelectedId(scenario.id)}
              >
                <strong>{scenario.id} · {scenario.title}</strong>
                <span>{scenario.description}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="row wrap-gap">
          <button type="button" disabled={busy || !isAuthenticated || hasActiveRun} onClick={() => void start()}>Új futás indítása</button>
          {busy ? <button type="button" className="btn-secondary" onClick={() => controllerRef.current?.abort()}>Megszakítás</button> : null}
          <button type="button" className="btn-secondary" disabled={busy || !run} onClick={clear}>Futás törlése</button>
        </div>
        {message ? <p role="alert" className="notice notice-warn">{message}</p> : null}
      </section>

      {activeManualStep ? (
        <section className="panel manual-checkpoint" aria-live="polite">
          <p className="eyebrow">Kézi ellenőrzőpont</p>
          <h3>{activeManualStep.title}</h3>
          <p>{activeManualStep.instruction}</p>
          <button type="button" disabled={busy} onClick={() => void continueManual()}>
            Elvégeztem, ellenőrzés és folytatás
          </button>
        </section>
      ) : null}

      {run && activeDefinition ? (
        <>
          <section className="panel" aria-live="polite">
            <div className="demo-run-heading">
              <div>
                <p className="eyebrow">{activeDefinition.id} · Futás {run.runId}</p>
                <h3>{activeDefinition.title}</h3>
              </div>
              <span className={`run-status status-${run.status}`}>{STATUS_LABELS[run.status]}</span>
            </div>
            <div className="demo-summary">
              <span>Szerepkör: <strong>{run.roles.join(', ') || '—'}</strong></span>
              <span>Tartalom: <strong className="mono">{run.contentId ?? '—'}</strong></span>
              <span>Állapot/verzió: <strong>{run.contentStatus ?? '—'} / {run.contentVersion ?? '—'}</strong></span>
            </div>
            <h4>Preflight</h4>
            <ul className="checklist evidence-checks">
              {run.preflight.map((check) => (
                <li key={check.label} className={check.passed ? 'check-pass' : 'check-fail'}>
                  {check.passed ? 'Siker' : 'Hiba'} · {check.label}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h3>Lépés-idővonal</h3>
            <ol className="scenario-list scenario-timeline">
              {activeDefinition.steps.map((definitionStep, index) => {
                const step = run.steps[index];
                return (
                  <li key={definitionStep.id} className={`step-${step.state}`}>
                    <div>
                      <strong>{index + 1}. {definitionStep.title}</strong>
                      <p className="muted">{definitionStep.detail}</p>
                      {step.assertions.length > 0 ? (
                        <ul className="assertion-list">
                          {step.assertions.map((assertion) => (
                            <li key={assertion.label}>{assertion.passed ? '✓' : '✕'} {assertion.label}</li>
                          ))}
                        </ul>
                      ) : null}
                      {step.note ? <p className="step-note">{step.note}</p> : null}
                    </div>
                    <div className="step-evidence">
                      <span>{stateLabel(step.state)}</span>
                      {step.httpStatus ? <span>HTTP {step.httpStatus}</span> : null}
                      {step.problemCode ? <span>{step.problemCode}</span> : null}
                      {step.durationMs !== null ? <span>{step.durationMs} ms</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="panel panel-muted">
            <h3>Biztonságos evidence export</h3>
            <p className="muted">Determinista, mező-allowlistelt JSON vagy Markdown. Az export a teljes API body-kat nem tárolja.</p>
            <div className="row wrap-gap">
              <button type="button" className="btn-secondary" onClick={() => exportRun('json')}>JSON letöltése</button>
              <button type="button" className="btn-secondary" onClick={() => exportRun('markdown')}>Markdown letöltése</button>
              {run.contentId ? <Link className="btn-secondary" to={`/contents/${run.contentId}`}>Tartalom megnyitása</Link> : null}
            </div>
            {run.scenarioId === 'S05' ? (
              <p className="row wrap-gap operations-links">
                <Link to="/operations/reindex">Reindex</Link>
                <Link to="/operations/quarantine">Karantén</Link>
                <Link to="/operations/repair">Javítás</Link>
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
