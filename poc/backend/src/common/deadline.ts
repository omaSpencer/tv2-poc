/**
 * Wait for work until the deadline elapses. The timer is always cleared when
 * work settles first, so a fast shutdown cannot keep the event loop alive.
 *
 * A non-positive deadline intentionally does not wait for work. Callers use
 * this to express an already-expired shutdown budget.
 */
export async function raceDeadline(work: Promise<unknown>, delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work.then(() => undefined),
      new Promise<void>(resolve => { timer = setTimeout(resolve, delayMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
