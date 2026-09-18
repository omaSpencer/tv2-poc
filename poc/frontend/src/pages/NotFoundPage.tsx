import { Link, useLocation, useNavigate } from 'react-router';
import { hasSafeInAppHistoryPredecessor } from '../navigation/inAppHistory';

export function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();

  function goBack() {
    if (hasSafeInAppHistoryPredecessor(window.history.state, location.key)) {
      navigate(-1);
      return;
    }
    navigate('/', { replace: true });
  }

  return (
    <section className="panel">
      <h2>Az oldal nem található</h2>
      <p>
        Ez az útvonal nem része az alkalmazásnak. A kezdőlapról elérheted a publikus
        és a belépés utáni felületeket.
      </p>
      <div className="row wrap-gap">
        <Link to="/">Főoldal</Link>
        <button type="button" className="btn-secondary" onClick={goBack}>Vissza</button>
      </div>
    </section>
  );
}
