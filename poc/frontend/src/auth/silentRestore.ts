const SILENT_RESTORE_SUPPRESSED_KEY = 'indaplay.poc.silentRestoreSuppressed';

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Non-secret logout intent: prevents prompt=none from undoing explicit logout. */
export function silentRestoreSuppressed(): boolean {
  return sessionStore()?.getItem(SILENT_RESTORE_SUPPRESSED_KEY) === '1';
}

export function suppressSilentRestore(): void {
  sessionStore()?.setItem(SILENT_RESTORE_SUPPRESSED_KEY, '1');
}

export function allowSilentRestore(): void {
  sessionStore()?.removeItem(SILENT_RESTORE_SUPPRESSED_KEY);
}
