import { createContext, useContext } from 'react';

export type ActiveContentValue = {
  contentId: string;
  setContentId: (id: string) => void;
};

export const ActiveContentContext = createContext<ActiveContentValue | null>(null);

export function useActiveContent(): ActiveContentValue {
  const context = useContext(ActiveContentContext);
  if (!context) throw new Error('useActiveContent requires ActiveContentProvider');
  return context;
}
