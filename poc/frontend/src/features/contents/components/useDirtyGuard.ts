import { useEffect } from 'react';
import { unstable_usePrompt as usePrompt } from 'react-router';

const MESSAGE = 'A nem mentett módosítások elvesznek. Biztosan elhagyod az oldalt?';

export function useDirtyGuard(dirty: boolean): () => boolean {
  usePrompt({ when: dirty, message: MESSAGE });
  useEffect(() => {
    if (!dirty) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [dirty]);

  return () => !dirty || window.confirm(MESSAGE);
}
