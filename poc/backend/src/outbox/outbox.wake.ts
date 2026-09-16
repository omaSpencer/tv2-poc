/**
 * In-process wake signals for the outbox relay.
 *
 * Two channels, deliberately separate:
 *
 * - `signal()` is the content channel. A successful content transaction that
 *   wrote an outbox row calls it after commit; it only shortens an *idle* poll.
 *   A lost signal adds one poll interval of latency, never a lost event.
 * - `interrupt()` is the shutdown channel. It releases every waiter, including
 *   retry backoffs, and stays latched until `resume()`, so a stop requested
 *   just before a wait cannot be missed.
 *
 * `backoff()` is the retry wait: CMS traffic must not shorten the mandatory
 * delay after a broker failure (R06), so only `interrupt()` ends it early.
 *
 * Every wait registers exactly one cleanup that clears its own timer and
 * removes its own entry, whichever side fires first (R12).
 */
import { Injectable } from '@nestjs/common';

type Waiter = () => void;

@Injectable()
export class OutboxWake {
  /** Waiters that both `signal()` and `interrupt()` release. */
  private readonly idleWaiters = new Set<Waiter>();
  /** Waiters that only `interrupt()` releases. */
  private readonly backoffWaiters = new Set<Waiter>();
  private interrupted = false;

  /** New outbox row committed. Shortens idle polling only. */
  signal(): void {
    this.release(this.idleWaiters);
  }

  /** Shutdown requested. Releases every waiter and latches until `resume()`. */
  interrupt(): void {
    this.interrupted = true;
    this.release(this.idleWaiters);
    this.release(this.backoffWaiters);
  }

  /** Clears the shutdown latch so a restarted relay can wait again. */
  resume(): void {
    this.interrupted = false;
  }

  /** Idle poll: ends on timeout, on a new event, or on shutdown. */
  wait(timeoutMs: number): Promise<void> {
    return this.park(this.idleWaiters, timeoutMs);
  }

  /** Retry/halted backoff: ends on timeout or on shutdown, never on an event. */
  backoff(delayMs: number): Promise<void> {
    return this.park(this.backoffWaiters, delayMs);
  }

  /** Diagnostics and tests: waiters currently parked. */
  get pendingWaiters(): number {
    return this.idleWaiters.size + this.backoffWaiters.size;
  }

  private park(set: Set<Waiter>, timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0 || this.interrupted) return Promise.resolve();
    return new Promise<void>(resolve => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        set.delete(waiter);
        resolve();
      };
      const waiter: Waiter = finish;
      const timer = setTimeout(finish, timeoutMs);
      set.add(waiter);
    });
  }

  private release(set: Set<Waiter>): void {
    if (set.size === 0) return;
    const current = [...set];
    set.clear();
    for (const waiter of current) waiter();
  }
}
