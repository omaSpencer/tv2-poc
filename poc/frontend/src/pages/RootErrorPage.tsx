import { useEffect, useRef } from 'react';
import { useLocation, useRouteError } from 'react-router';
import {
  isLazyChunkLoadError,
  LAZY_CHUNK_BUILD_ID,
  reloadDocument,
  takeLazyChunkReload,
} from '../lib/lazyChunkError';

type Props = {
  reload?: () => void;
  buildId?: string;
};

export function RootErrorPage({
  reload = reloadDocument,
  buildId = LAZY_CHUNK_BUILD_ID,
}: Props = {}) {
  const error = useRouteError();
  const location = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const chunkError = isLazyChunkLoadError(error);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!chunkError) return;
    if (takeLazyChunkReload(location.pathname, buildId)) reload();
  }, [buildId, chunkError, location.pathname, reload]);

  return (
    <div className="app">
      <main id="main-content" className="main" tabIndex={-1}>
        <section className="panel panel-error" role="alert">
          <h1 ref={headingRef} tabIndex={-1}>Az oldal nem tölthető be</h1>
          <p>
            {chunkError
              ? 'A felület egy frissített kódrészletét nem sikerült betölteni. Az oldal egyszer automatikusan újratöltődhet; ha a hiba megmarad, töltsd újra kézzel.'
              : 'Váratlan hiba történt. A szerveroldali adatok ettől nem vesztek el; az oldal újratöltése általában elég.'}
          </p>
          <p className="muted">A hiba részletei biztonsági okból nem jelennek meg.</p>
          <div className="row">
            <button type="button" onClick={() => reload()}>Oldal újratöltése</button>
            <a href="/">Vissza a kezdőlapra</a>
          </div>
        </section>
      </main>
    </div>
  );
}
