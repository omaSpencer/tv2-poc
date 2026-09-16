import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  createContent,
  getAdminContent,
  patchContent,
  publishContent,
  withdrawContent,
} from '../api/admin';
import { fetchPublishedContent } from '../api/catalog';
import { isApiProblemError, type AdminContentView, type ProblemDocument } from '../api/types';
import { useAuth } from '../auth/authContext';
import { useActiveContent } from '../content/activeContentContext';
import {
  DEMO_CONTENT,
  DEMO_EDIT,
  DEMO_WITHDRAWN_EDIT,
  NEGATIVE_CASES,
} from '../data/demoFixture';
import { JsonBlock } from '../components/JsonBlock';
import { MilestoneGate } from '../components/MilestoneGate';
import { ProblemPanel } from '../components/ProblemPanel';

type StepId =
  | 'create'
  | 'edit'
  | 'publish'
  | 'catalog-ok'
  | 'withdraw'
  | 'catalog-404'
  | 'edit-withdrawn'
  | 'republish'
  | 'catalog-ok-2';

type StepDef = {
  id: StepId;
  title: string;
  detail: string;
};

const LIFECYCLE: StepDef[] = [
  { id: 'create', title: '1. Draft létrehozás', detail: 'POST /admin/contents → v1' },
  { id: 'edit', title: '2. Szerkesztés', detail: 'PATCH DEMO_EDIT → v2' },
  { id: 'publish', title: '3. Publikálás', detail: 'POST …/publish → v3' },
  { id: 'catalog-ok', title: '4. Katalógus GET', detail: '200 publikus nézet' },
  { id: 'withdraw', title: '5. Visszavonás', detail: 'POST …/withdraw → v4' },
  { id: 'catalog-404', title: '6. Katalógus GET', detail: '404 punchline' },
  { id: 'edit-withdrawn', title: '7. Withdrawn szerkesztés', detail: 'PATCH title → v5' },
  { id: 'republish', title: '8. Újrapublikálás', detail: 'publish → v6' },
  { id: 'catalog-ok-2', title: '9. Katalógus GET', detail: 'ismét 200' },
];

type LogEntry = { step: string; ok: boolean; message: string; payload?: unknown };

type ExpectedProblem = {
  status: number;
  code: ProblemDocument['code'];
  fields?: string[];
};

function expectProblem(error: unknown, expected: ExpectedProblem): ProblemDocument {
  if (!isApiProblemError(error)) {
    throw new Error(
      `Várt HTTP ${expected.status} ${expected.code}, de nem problem+json hiba érkezett: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const { problem } = error;
  if (problem.status !== expected.status || problem.code !== expected.code) {
    throw new Error(
      `Várt HTTP ${expected.status} ${expected.code}, kapott HTTP ${problem.status} ${problem.code}.`,
    );
  }
  const missingFields = (expected.fields ?? []).filter(
    (field) => !(problem.fields ?? []).includes(field),
  );
  if (missingFields.length > 0) {
    throw new Error(`A várt problem fields hiányzik: ${missingFields.join(', ')}.`);
  }
  return problem;
}

export function DemoPage() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const { contentId, setContentId } = useActiveContent();
  const [done, setDone] = useState<Partial<Record<StepId, boolean>>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [lastError, setLastError] = useState<unknown>(null);
  const [adminSnapshot, setAdminSnapshot] = useState<AdminContentView | null>(null);

  function pushLog(entry: LogEntry) {
    setLog((prev) => [...prev, entry]);
  }

  function mark(id: StepId, ok: boolean) {
    setDone((prev) => ({ ...prev, [id]: ok }));
  }

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-content'] }),
      queryClient.invalidateQueries({ queryKey: ['catalog-content'] }),
      queryClient.invalidateQueries({ queryKey: ['search'] }),
      queryClient.invalidateQueries({ queryKey: ['processing'] }),
    ]);
  }

  const runStep = useMutation({
    mutationFn: async (stepId: StepId) => {
      if (!isAuthenticated && stepId !== 'catalog-ok' && stepId !== 'catalog-404' && stepId !== 'catalog-ok-2') {
        throw new Error('Admin lépésekhez érvényes munkamenet kell.');
      }

      let current = adminSnapshot;
      let id = contentId || current?.id || '';

      if (stepId === 'create') {
        const res = await createContent({ ...DEMO_CONTENT });
        setContentId(res.data.id);
        setAdminSnapshot(res.data);
        return { stepId, res };
      }

      if (!id && current) id = current.id;
      if (!id) throw new Error('Nincs content id – futtasd a create lépést.');

      if (stepId === 'edit') {
        const version = current?.version ?? (await getAdminContent(id)).data.version;
        const res = await patchContent(
          id,
          { expectedVersion: version, summary: DEMO_EDIT.summary, tags: [...DEMO_EDIT.tags] },
        );
        setAdminSnapshot(res.data);
        return { stepId, res };
      }

      if (stepId === 'publish' || stepId === 'republish') {
        const version = current?.version ?? (await getAdminContent(id)).data.version;
        const res = await publishContent(id, { expectedVersion: version });
        setAdminSnapshot(res.data);
        return { stepId, res };
      }

      if (stepId === 'withdraw') {
        const version = current?.version ?? (await getAdminContent(id)).data.version;
        const res = await withdrawContent(id, { expectedVersion: version });
        setAdminSnapshot(res.data);
        return { stepId, res };
      }

      if (stepId === 'edit-withdrawn') {
        const version = current?.version ?? (await getAdminContent(id)).data.version;
        const res = await patchContent(
          id,
          { expectedVersion: version, title: DEMO_WITHDRAWN_EDIT.title },
        );
        setAdminSnapshot(res.data);
        return { stepId, res };
      }

      if (stepId === 'catalog-ok' || stepId === 'catalog-ok-2') {
        const res = await fetchPublishedContent(id);
        return { stepId, res };
      }

      if (stepId === 'catalog-404') {
        try {
          await fetchPublishedContent(id);
          throw new Error('Várt 404 helyett siker – a tartalom még published?');
        } catch (error) {
          const problem = expectProblem(error, { status: 404, code: 'content_not_found' });
          return { stepId, res: null, expectedError: problem };
        }
      }

      throw new Error(`Ismeretlen lépés: ${stepId}`);
    },
    onSuccess: async (result) => {
      setLastError(null);
      const { stepId } = result;
      if (stepId === 'catalog-404' && 'expectedError' in result) {
        mark(stepId, true);
        pushLog({
          step: stepId,
          ok: true,
          message: 'HTTP 404 content_not_found a várakozás szerint',
          payload: result.expectedError,
        });
      } else if (result.res) {
        mark(stepId, true);
        pushLog({
          step: stepId,
          ok: true,
          message: `HTTP ${result.res.status}`,
          payload: result.res.data,
        });
      }
      await invalidateAll();
    },
    onError: (error, stepId) => {
      setLastError(error);
      mark(stepId, false);
      pushLog({
        step: stepId,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const negCreate = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated) throw new Error('Érvényes munkamenet kell.');
      return createContent({ ...NEGATIVE_CASES.missingMediaAsset });
    },
    onSuccess: async (res) => {
      setLastError(null);
      setContentId(res.data.id);
      setAdminSnapshot(res.data);
      pushLog({
        step: 'neg-create-no-media',
        ok: true,
        message: 'Draft media nélkül (publish majd 422-t kell adjon)',
        payload: res.data,
      });
      await invalidateAll();
    },
    onError: (error) => {
      setLastError(error);
      pushLog({ step: 'neg-create-no-media', ok: false, message: String(error) });
    },
  });

  const negPublish = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated || !contentId) throw new Error('Munkamenet + content id.');
      const row = adminSnapshot ?? (await getAdminContent(contentId)).data;
      try {
        const res = await publishContent(contentId, { expectedVersion: row.version });
        throw new Error(`Várt 422 validation_failed, de HTTP ${res.status} érkezett.`);
      } catch (error) {
        return expectProblem(error, {
          status: 422,
          code: 'validation_failed',
          fields: ['mediaAssetId'],
        });
      }
    },
    onSuccess: (problem) => {
      setLastError(null);
      pushLog({
        step: 'neg-publish-incomplete',
        ok: true,
        message: 'HTTP 422 validation_failed, mediaAssetId mezővel',
        payload: problem,
      });
    },
    onError: (error) => {
      setLastError(error);
      pushLog({
        step: 'neg-publish-incomplete',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const negStale = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated || !contentId) throw new Error('Munkamenet + content id.');
      try {
        const res = await patchContent(
          contentId,
          {
            expectedVersion: NEGATIVE_CASES.conflictingExpectedVersion,
            summary: 'stale version probe',
          },
        );
        throw new Error(`Várt 409 version_conflict, de HTTP ${res.status} érkezett.`);
      } catch (error) {
        return expectProblem(error, { status: 409, code: 'version_conflict' });
      }
    },
    onSuccess: (problem) => {
      setLastError(null);
      pushLog({
        step: 'neg-stale-version',
        ok: true,
        message: 'HTTP 409 version_conflict a várakozás szerint',
        payload: problem,
      });
    },
    onError: (error) => {
      setLastError(error);
      pushLog({
        step: 'neg-stale-version',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  });

  return (
    <div className="stack-pages">
      <section className="panel">
        <h2>Demo forgatókönyv</h2>
        <p className="muted">
          Az M1 mintafolyamat UI-ból. Aktív id: <span className="mono">{contentId || '—'}</span>.{' '}
          <Link to="/auth">Auth</Link> · <Link to="/editorial">Editorial</Link> ·{' '}
          <Link to="/catalog">Catalog</Link>
        </p>
        {!isAuthenticated ? (
          <MilestoneGate
            milestone="M2"
            feature="Tokenes admin demó"
            detail="Katalógus lépések anonim módon is futtathatók; a többihez bejelentkezés kell."
          />
        ) : null}

        <ol className="scenario-list">
          {LIFECYCLE.map((step) => {
            const state = done[step.id];
            return (
              <li key={step.id} className={state === true ? 'step-ok' : state === false ? 'step-bad' : undefined}>
                <div>
                  <strong>{step.title}</strong>
                  <span className="muted"> — {step.detail}</span>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={runStep.isPending}
                  onClick={() => runStep.mutate(step.id)}
                >
                  Futtat
                </button>
              </li>
            );
          })}
        </ol>

        <div className="row wrap-gap">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setDone({});
              setLog([]);
              setLastError(null);
              setAdminSnapshot(null);
            }}
          >
            Log / checklist törlése
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>Negatív esetek</h3>
        <p className="muted">
          Hiányos publish (nincs mediaAssetId), elavult expectedVersion. Viewer 403: Auth oldalon
          viewer tokennel próbáld az Editorial Create-et.
        </p>
        <div className="row wrap-gap">
          <button
            type="button"
            className="btn-secondary"
            disabled={!isAuthenticated || negCreate.isPending}
            onClick={() => negCreate.mutate()}
          >
            Create media nélkül
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!isAuthenticated || !contentId || negPublish.isPending}
            onClick={() => negPublish.mutate()}
          >
            Publish (várható 422)
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={!isAuthenticated || !contentId || negStale.isPending}
            onClick={() => negStale.mutate()}
          >
            Stale version patch
          </button>
        </div>
      </section>

      <section className="panel panel-muted">
        <h3>M5 runbook (narratíva)</h3>
        <ul className="checklist">
          <li>Relay leállás publish ACK után – script / jegyzőkönyv, nem ez a UI</li>
          <li>Index A/B kiesés – Search + Processing panelekkel bemutatható</li>
          <li>Reindex – operátori parancs; a playground csak követi a státuszt</li>
        </ul>
      </section>

      {lastError ? <ProblemPanel error={lastError} title="Utolsó hiba" /> : null}
      {log.length > 0 ? (
        <section className="panel">
          <h3>Lépésnapló</h3>
          <JsonBlock value={log} />
        </section>
      ) : null}
    </div>
  );
}
