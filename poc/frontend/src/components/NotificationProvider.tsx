import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { NotificationContext, type NotificationTone } from './notificationContext';

export const SUCCESS_TOAST_TIMEOUT_MS = 5_000;
export const TOAST_CLOSE_LABEL = 'Értesítés bezárása';

type Notice = { id: number; message: string; tone: NotificationTone };

let nextNoticeId = 0;

function ToastItem({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: (id: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const remainingRef = useRef(SUCCESS_TOAST_TIMEOUT_MS);
  const startedAtRef = useRef(0);
  const timeoutRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  const autoClose = notice.tone !== 'error';

  const clearTimer = useCallback(() => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const startTimer = useCallback(() => {
    if (!autoClose) return;
    clearTimer();
    startedAtRef.current = Date.now();
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      onDismissRef.current(notice.id);
    }, remainingRef.current);
  }, [autoClose, clearTimer, notice.id]);

  const syncPause = useCallback(() => {
    if (!autoClose) return;
    const shouldPause = hoverRef.current || focusRef.current;
    if (shouldPause) {
      if (!pausedRef.current && timeoutRef.current !== null) {
        remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startedAtRef.current));
        clearTimer();
      }
      pausedRef.current = true;
      return;
    }
    if (!pausedRef.current) return;
    pausedRef.current = false;
    startTimer();
  }, [autoClose, clearTimer, startTimer]);

  useEffect(() => {
    startTimer();
    return () => {
      clearTimer();
    };
  }, [clearTimer, startTimer]);

  return (
    <div
      ref={rootRef}
      className={`toast toast-${notice.tone}`}
      onMouseEnter={() => {
        hoverRef.current = true;
        syncPause();
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
        syncPause();
      }}
      onFocusCapture={() => {
        focusRef.current = true;
        syncPause();
      }}
      onBlurCapture={(event: FocusEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && rootRef.current?.contains(next)) return;
        focusRef.current = false;
        syncPause();
      }}
    >
      <p
        role={notice.tone === 'error' ? 'alert' : 'status'}
        aria-live={notice.tone === 'error' ? 'assertive' : 'polite'}
        aria-atomic="true"
      >
        {notice.message}
      </p>
      <button type="button" className="toast-close" aria-label={TOAST_CLOSE_LABEL} onClick={() => onDismiss(notice.id)}>
        Bezárás
      </button>
    </div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const dismiss = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);
  const notify = useCallback((message: string, tone: NotificationTone = 'success') => {
    const id = ++nextNoticeId;
    setNotices((current) => [...current, { id, message, tone }]);
  }, []);
  const value = useMemo(() => ({ notify }), [notify]);
  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="toast-region">
        {notices.map((notice) => (
          <ToastItem key={notice.id} notice={notice} onDismiss={dismiss} />
        ))}
      </div>
    </NotificationContext.Provider>
  );
}
