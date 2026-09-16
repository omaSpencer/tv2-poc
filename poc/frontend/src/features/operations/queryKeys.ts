export const operationsKeys = {
  all: ['operations'] as const,
  status: () => [...operationsKeys.all, 'processing-status'] as const,
};
