/**
 * Observable relay state for processing-status (M3-05) and structured logs.
 */
export type RelayRunState = 'off' | 'idle' | 'publishing' | 'retrying' | 'halted';

export type RelayStatusSnapshot = {
  enabled: boolean;
  state: RelayRunState;
  lastDeliveredAt: string | null;
  lastErrorCode: string | null;
};

export class RelayState {
  enabled = false;
  state: RelayRunState = 'off';
  lastDeliveredAt: Date | null = null;
  lastErrorCode: string | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.state = 'off';
      return;
    }
    if (this.state === 'off') this.state = 'idle';
  }

  setState(state: RelayRunState): void {
    if (!this.enabled && state !== 'off') return;
    this.state = this.enabled ? state : 'off';
  }

  markDelivered(at = new Date()): void {
    this.lastDeliveredAt = at;
    this.lastErrorCode = null;
  }

  markError(code: string): void {
    this.lastErrorCode = code;
  }

  snapshot(): RelayStatusSnapshot {
    return {
      enabled: this.enabled,
      state: this.enabled ? this.state : 'off',
      lastDeliveredAt: this.lastDeliveredAt?.toISOString() ?? null,
      lastErrorCode: this.lastErrorCode,
    };
  }
}
