import type { AppPermission, AppRole, ContentStatus, ProblemDocument } from '../../api/types';

export const SCENARIO_VERSION = 1 as const;

export type ScenarioId = 'S01' | 'S02' | 'S03' | 'S04' | 'S05';
export type ScenarioMode = 'automatic' | 'manual';

export type AllowedOperation =
  | 'health.ready'
  | 'auth.me'
  | 'content.create-complete'
  | 'content.edit'
  | 'content.publish'
  | 'content.admin-read'
  | 'content.catalog-present'
  | 'content.search-present'
  | 'content.withdraw'
  | 'content.catalog-absent'
  | 'content.search-absent'
  | 'content.edit-withdrawn'
  | 'content.audit'
  | 'negative.create-incomplete'
  | 'negative.publish-incomplete'
  | 'negative.create-published'
  | 'negative.patch-published'
  | 'negative.create-advanced'
  | 'negative.patch-stale'
  | 'negative.invalid-payload'
  | 'negative.oversized-payload'
  | 'permission.admin-read'
  | 'permission.missing-token'
  | 'permission.create'
  | 'permission.publish'
  | 'outage.processing'
  | 'outage.search'
  | 'outage.cms-write';

export type ExpectedResult =
  | { kind: 'http'; status: number }
  | {
      kind: 'problem';
      status: number;
      code: ProblemDocument['code'];
      fields?: string[];
      versionRelation?: 'expected-less-than-actual';
    }
  | { kind: 'content'; status: ContentStatus; version: number }
  | { kind: 'catalog'; present: boolean }
  | { kind: 'search'; containsContent: boolean }
  | { kind: 'identity'; roles: AppRole[]; permissions?: AppPermission[] }
  | { kind: 'processing'; routeEligible: number; reachable: number }
  | { kind: 'audit'; sequence: Array<{ action: string; version: number }> };

export type ScenarioStep = {
  id: string;
  title: string;
  detail: string;
  mode: ScenarioMode;
  operation?: AllowedOperation;
  expected: ExpectedResult[];
  timeoutMs?: number;
  instruction?: string;
};

export type ScenarioDefinition = {
  id: ScenarioId;
  version: typeof SCENARIO_VERSION;
  title: string;
  description: string;
  requiredPermissions: AppPermission[];
  preflight: {
    authenticated: boolean;
    backendReady: boolean;
    searchEnabled: boolean;
  };
  steps: ScenarioStep[];
};

export type StepState = 'pending' | 'running' | 'passed' | 'failed' | 'manual' | 'inconclusive';
export type RunStatus =
  | 'running'
  | 'waiting_manual'
  | 'passed'
  | 'failed'
  | 'cancelled'
  | 'inconclusive';

export type AssertionResult = {
  label: string;
  passed: boolean;
};

export type SafeStepResult = {
  stepId: string;
  title: string;
  state: StepState;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  httpStatus?: number;
  problemCode?: ProblemDocument['code'];
  correlationId?: string;
  contentVersion?: number;
  contentStatus?: ContentStatus;
  assertions: AssertionResult[];
  note?: string;
};

export type SafeRunContext = {
  schemaVersion: 1;
  scenarioId: ScenarioId;
  scenarioVersion: typeof SCENARIO_VERSION;
  runId: string;
  subjectHash: string;
  roles: AppRole[];
  permissions: AppPermission[];
  status: RunStatus;
  currentStepIndex: number;
  contentId: string | null;
  contentVersion: number | null;
  contentStatus: ContentStatus | null;
  contentTitle: string | null;
  startedAt: string;
  completedAt: string | null;
  preflight: AssertionResult[];
  steps: SafeStepResult[];
};

export type OperationObservation = {
  httpStatus: number;
  correlationId: string;
  problem?: ProblemDocument;
  data?: unknown;
  contextPatch?: Partial<
    Pick<SafeRunContext, 'contentId' | 'contentVersion' | 'contentStatus' | 'contentTitle'>
  >;
};
