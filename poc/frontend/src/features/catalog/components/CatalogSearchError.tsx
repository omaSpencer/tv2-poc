import { isApiProblemError } from '../../../api/types';

type Props = {
  error: unknown;
  onRetry: () => void;
  onReset: () => void;
};

export function CatalogSearchError({ error, onRetry, onReset }: Props) {
  if (isApiProblemError(error) && error.problem.status === 422) {
    return (
      <aside className="panel panel-error" role="alert">
        <h2>A keresési URL hibás</h2>
        <p>A szerver nem fogadta el ezeket a mezőket: {error.problem.fields?.join(', ') || 'ismeretlen mező'}.</p>
        <button type="button" onClick={onReset}>Szűrők alaphelyzetbe állítása</button>
      </aside>
    );
  }

  if (isApiProblemError(error) && error.problem.code === 'search_unavailable') {
    return (
      <aside className="panel panel-error" role="alert">
        <h2>A keresés átmenetileg nem elérhető</h2>
        <p>Egyik keresőindex sem tudja most kiszolgálni a kérést. A katalógus tartalma ettől nem veszett el.</p>
        <button type="button" onClick={onRetry}>Újrapróbálás</button>
      </aside>
    );
  }

  if (isApiProblemError(error) && error.problem.code === 'dependency_unavailable') {
    return (
      <aside className="panel panel-error" role="alert">
        <h2>Egy háttérszolgáltatás nem elérhető</h2>
        <p>A találatok publikus állapotát most nem lehet biztonságosan ellenőrizni.</p>
        <button type="button" onClick={onRetry}>Újrapróbálás</button>
      </aside>
    );
  }

  return (
    <aside className="panel panel-error" role="alert">
      <h2>Kapcsolati hiba</h2>
      <p>A keresési kérés nem ért célba. Ellenőrizd a kapcsolatot, majd próbáld újra.</p>
      <button type="button" onClick={onRetry}>Újrapróbálás</button>
    </aside>
  );
}
