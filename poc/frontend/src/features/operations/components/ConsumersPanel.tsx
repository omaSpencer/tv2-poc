import type { ProcessingStatus } from '../../../api/types';
import { formatDurationMs, formatInteger } from '../format';
import { TimestampValue } from './TimestampValue';

type Consumer = NonNullable<ProcessingStatus['consumers']>[number];

function ConsumerFields({ consumer }: { consumer: Consumer }) {
  return (
    <>
      <div><dt>Függő</dt><dd>{formatInteger(consumer.pending)}</dd></div>
      <div><dt>Függő ACK</dt><dd>{formatInteger(consumer.ackPending)}</dd></div>
      <div><dt>ACK-küszöb</dt><dd>{formatInteger(consumer.ackFloorStreamSequence)}</dd></div>
      <div><dt>Legrégebbi feldolgozatlan</dt><dd>{formatDurationMs(consumer.oldestUnfinishedAgeMs)}</dd></div>
      <div><dt>Pontos idő</dt><dd><TimestampValue value={consumer.oldestUnfinishedAt} /></dd></div>
    </>
  );
}

export function ConsumersPanel({
  consumers,
  unavailable,
}: {
  consumers: ProcessingStatus['consumers'];
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <section className="panel ops-callout ops-callout-warning" role="status">
        <h2>A fogyasztói adatok nem kérhetők le</h2>
        <p>A broker elérhető állapotától függetlenül a durable consumer snapshot most hiányzik.</p>
      </section>
    );
  }
  if (consumers === undefined) {
    return (
      <section className="panel panel-muted" role="status">
        <h2>Tartós fogyasztók</h2>
        <p>Fogyasztói adat nem érhető el ebben a konfigurációban.</p>
      </section>
    );
  }
  if (consumers.length === 0) {
    return (
      <section className="panel panel-muted" role="status">
        <h2>Tartós fogyasztók</h2>
        <p>Nincs jelentett tartós fogyasztó. Ez önmagában nem jelent egészséges állapotot.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Tartós fogyasztók</h2>
      <div className="operations-consumer-table table-scroll">
        <table>
          <thead><tr><th>Név</th><th>Függő</th><th>Függő ACK</th><th>ACK-küszöb</th><th>Legrégebbi</th><th>Pontos idő</th></tr></thead>
          <tbody>
            {consumers.map(consumer => (
              <tr key={consumer.name}>
                <th scope="row" className="mono">{consumer.name}</th>
                <td>{formatInteger(consumer.pending)}</td>
                <td>{formatInteger(consumer.ackPending)}</td>
                <td>{formatInteger(consumer.ackFloorStreamSequence)}</td>
                <td>{formatDurationMs(consumer.oldestUnfinishedAgeMs)}</td>
                <td><TimestampValue value={consumer.oldestUnfinishedAt} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="operations-consumer-cards">
        {consumers.map(consumer => (
          <article className="subpanel" key={consumer.name}>
            <h3 className="mono">{consumer.name}</h3>
            <dl className="kv compact-kv"><ConsumerFields consumer={consumer} /></dl>
          </article>
        ))}
      </div>
    </section>
  );
}
