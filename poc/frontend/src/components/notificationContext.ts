import { createContext, useContext } from 'react';

export type NotificationTone = 'success' | 'error';
export type NotificationValue = {
  notify: (message: string, tone?: NotificationTone) => void;
};

export const NotificationContext = createContext<NotificationValue | null>(null);

export function useNotifications(): NotificationValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications requires NotificationProvider');
  return context;
}

