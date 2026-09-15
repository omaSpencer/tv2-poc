/**
 * In-process wake signal for the outbox relay. A successful content transaction
 * that wrote an outbox row calls `signal()` after commit. The relay waits on
 * `wait()` between empty polls. A lost signal only adds one poll interval of
 * latency; correctness never depends on it.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class OutboxWake {
  private waiter: { resolve: () => void; promise: Promise<void> } | null = null;

  signal(): void {
    const current = this.waiter;
    this.waiter = null;
    current?.resolve();
  }

  wait(timeoutMs: number): Promise<void> {
    if (timeoutMs <= 0) return Promise.resolve();
    if (!this.waiter) {
      let resolve!: () => void;
      const promise = new Promise<void>(r => {
        resolve = r;
      });
      this.waiter = { resolve, promise };
    }
    const signalled = this.waiter.promise;
    return new Promise(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      void signalled.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
