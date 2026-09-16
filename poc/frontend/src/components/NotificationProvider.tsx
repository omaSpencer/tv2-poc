import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { NotificationContext, type NotificationTone } from './notificationContext';

type Notice = { id: number; message: string; tone: NotificationTone };

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((message: string, tone: NotificationTone = 'success') => {
    const id = Date.now() + Math.random();
    setNotices((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 5_000);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-atomic="false">
        {notices.map((notice) => (
          <div className={`toast toast-${notice.tone}`} key={notice.id}>{notice.message}</div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
