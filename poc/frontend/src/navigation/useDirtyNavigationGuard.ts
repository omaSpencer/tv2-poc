import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';

export const DIRTY_LEAVE_MESSAGE = 'A nem mentett módosítások elvesznek. Biztosan elhagyod az oldalt?';

/**
 * Egyetlen dirty-navigation adapter: belső route-váltást a pinelt React Router
 * `useBlocker` API blokkol, a tab/window bezárását pedig a böngésző natív
 * `beforeunload` promptja. Az alkalmazás a natív prompt szövegét nem állítja.
 */
export function useDirtyNavigationGuard(dirty: boolean): void {
  const blocker = useBlocker(dirty);
  const promptLock = useRef(false);

  useEffect(() => {
    if (blocker.state !== 'blocked' || promptLock.current) return;
    promptLock.current = true;
    const leave = window.confirm(DIRTY_LEAVE_MESSAGE);
    if (leave) blocker.proceed();
    else blocker.reset();
    promptLock.current = false;
  }, [blocker]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);
}
