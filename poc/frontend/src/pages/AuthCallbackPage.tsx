import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/authContext';

export function AuthCallbackPage() {
  const { completeCallback } = useAuth();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
    let active = true;
    void completeCallback()
      .then((returnTo) => {
        if (active) navigate(returnTo, { replace: true });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [completeCallback, navigate]);

  return (
    <section className="panel" role="status">
      <h2 ref={headingRef} tabIndex={-1}>Beléptetés folyamatban</h2>
      {failed ? (
        <p>A callback feldolgozása sikertelen. <a href="/login">Vissza a bejelentkezéshez</a>.</p>
      ) : <p className="muted">A kód és a PKCE verifier ellenőrzése…</p>}
    </section>
  );
}

