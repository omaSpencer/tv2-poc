import type { ProcessingStatus } from '../../../api/types';
import { formatDurationMs, formatInteger } from '../format';
import { RELAY_LABELS, relayTone } from '../viewModel';
import { StatusBadge } from './StatusBadge';
import { TimestampValue } from './TimestampValue';

export function ServiceCards({ status }: { status: ProcessingStatus }) {
  const { outbox, relay, broker, quarantine } = status;

  return (
    <div className="operations-service-grid" aria-label="Háttérszolgáltatások állapota">
      <section className="panel operations-service-card">
        <header className="operations-card-header">
          <h2>Outbox</h2>
          <StatusBadge tone="neutral">{formatInteger(outbox.pending)} függő</StatusBadge>
        </header>
        <dl className="kv compact-kv">
          <div><dt>Függő események</dt><dd>{formatInteger(outbox.pending)}</dd></div>
          <div><dt>Legrégebbi kora</dt><dd>{formatDurationMs(outbox.oldestAgeMs)}</dd></div>
          <div><dt>Pontos idő</dt><dd><TimestampValue value={outbox.oldestOccurredAt} /></dd></div>
        </dl>
      </section>

      <section className="panel operations-service-card">
        <header className="operations-card-header">
          <h2>Relay</h2>
          <StatusBadge tone={relayTone(relay.enabled, relay.state)}>
            {relay.enabled ? RELAY_LABELS[relay.state] : 'Kikapcsolva'}
          </StatusBadge>
        </header>
        <dl className="kv compact-kv">
          <div><dt>Engedélyezve</dt><dd>{relay.enabled ? 'Igen' : 'Nem'}</dd></div>
          <div><dt>Runtime állapot</dt><dd>{RELAY_LABELS[relay.state]}</dd></div>
          <div><dt>Utolsó kézbesítés</dt><dd><TimestampValue value={relay.lastDeliveredAt} /></dd></div>
          <div><dt>Utolsó hibakód</dt><dd className="mono">{relay.lastErrorCode ?? 'nincs'}</dd></div>
        </dl>
      </section>

      <section className="panel operations-service-card">
        <header className="operations-card-header">
          <h2>Broker</h2>
          <StatusBadge tone={broker.connected ? 'ok' : 'danger'}>
            {broker.connected ? 'Kapcsolódva' : 'Nincs kapcsolat'}
          </StatusBadge>
        </header>
        <dl className="kv compact-kv">
          <div><dt>Kapcsolat</dt><dd>{broker.connected ? 'Aktív' : 'Leállt'}</dd></div>
          <div>
            <dt>Stream</dt>
            <dd>
              {broker.streamPresent === null ? 'Még nem ismert' : broker.streamPresent ? 'Elérhető' : 'Hiányzik'}
            </dd>
          </div>
        </dl>
      </section>

      <section className={`panel operations-service-card${quarantine ? '' : ' panel-muted'}`}>
        <header className="operations-card-header">
          <h2>Karantén</h2>
          {quarantine ? (
            <StatusBadge tone={quarantine.pending > 0 ? 'warning' : 'neutral'}>
              {formatInteger(quarantine.pending)} függő
            </StatusBadge>
          ) : <StatusBadge tone="neutral">Nem elérhető</StatusBadge>}
        </header>
        {quarantine ? (
          <p>{quarantine.pending > 0 ? 'Beavatkozásra váró események vannak.' : 'Nincs jelentett karanténelem.'}</p>
        ) : <p>Ez a konfiguráció nem jelent karanténadatot.</p>}
      </section>
    </div>
  );
}
