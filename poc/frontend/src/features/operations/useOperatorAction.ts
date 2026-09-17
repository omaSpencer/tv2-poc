import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchOperatorAction } from '../../api/operations';
import { operationsKeys } from './queryKeys';

export function operatorActionPollInterval(state: string | undefined, visibility: DocumentVisibilityState): number | false {
  if (visibility !== 'visible' || state === 'succeeded' || state === 'failed') return false;
  return state === 'running' ? 2000 : 10_000;
}

export function useOperatorAction(id: string | null) {
  const query = useQuery({
    queryKey: operationsKeys.action(id ?? 'none'),
    queryFn: () => fetchOperatorAction(id!),
    enabled: id !== null,
    retry: false,
    refetchInterval: current => operatorActionPollInterval(current.state.data?.data.state, document.visibilityState),
    refetchIntervalInBackground: false,
  });
  const { refetch } = query;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && id !== null) void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [id, refetch]);
  return query;
}
