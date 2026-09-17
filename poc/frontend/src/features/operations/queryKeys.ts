export const operationsKeys = {
  all: ['operations'] as const,
  status: () => [...operationsKeys.all, 'processing-status'] as const,
  preflight: (index: 'a' | 'b', outage: boolean) => [...operationsKeys.all, 'reindex-preflight', index, outage] as const,
  action: (id: string) => [...operationsKeys.all, 'action', id] as const,
  reindexRun: (id: string) => [...operationsKeys.all, 'reindex-run', id] as const,
  quarantine: (cursor: string | null) => [...operationsKeys.all, 'quarantine', cursor] as const,
  quarantineItem: (sequence: number) => [...operationsKeys.all, 'quarantine-item', sequence] as const,
};
