import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button, TextField } from "../components/index.js";

export function TripJoinScreen() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    if (!code) {
      setError("Ingresá un código de invitación.");
      return;
    }
    navigate(`/invite/${encodeURIComponent(code)}`);
  };

  return (
    <main className="app-shell trips-shell">
      <section className="trip-form-panel" aria-labelledby="trip-join-title">
        <Link className="trips-back" to="/trips">Volver a mis viajes</Link>
        <h1 id="trip-join-title">Ingresar código</h1>
        <p>Ingresá el código que te compartieron para unirte a un viaje.</p>
        <form className="auth-form" onSubmit={submit} noValidate>
          <TextField label="Código de invitación" name="code" autoComplete="off" error={error}
            onChange={() => setError(undefined)} />
          <Button type="submit">Continuar</Button>
        </form>
      </section>
    </main>
  );
}
