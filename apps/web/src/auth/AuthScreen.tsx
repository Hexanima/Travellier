import { useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";

import { Button, Feedback, PasswordField, TextField } from "../components/index.js";
import type { AuthApi, AuthenticatedSession, AuthFailure } from "./auth-api.js";

export type AuthScreenMode = "login" | "register";

type AuthScreenProps = {
  auth?: Partial<AuthApi>;
  mode: AuthScreenMode;
  onAuthenticated?: (session: AuthenticatedSession) => void | Promise<void>;
  /** Solo en login: la sesión terminó por un 401 real. */
  sessionExpired?: boolean;
};

const validationMessages = {
  email: "Ingresá un email válido.",
  password: "Ingresá una contraseña.",
};

const fieldErrors = (error: AuthFailure): Record<string, string> =>
  Object.fromEntries((error.fields ?? []).map(({ field, message }) => [field, message]));

const sessionExpiredNotice = "Tu sesión venció. Entrá con tu cuenta para seguir; tus viajes no se eliminan.";

export function AuthScreen({ auth, mode, onAuthenticated, sessionExpired = false }: AuthScreenProps) {
  const location = useLocation();
  const isRegister = mode === "register";
  const title = isRegister ? "Crear cuenta" : "Iniciar sesión";
  const heading = isRegister ? "Vamos a viajar." : "Qué bueno verte.";
  const help = isRegister ? "Creá tu cuenta y empezá a armar el próximo viaje." : "Entrá para seguir con los planes de tu grupo.";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submitting.current) {
      return;
    }

    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "");
    const password = String(values.get("password") ?? "");
    const nextErrors: Record<string, string> = {};

    if (email.trim() === "" || !email.includes("@")) {
      nextErrors.email = validationMessages.email;
    }

    if (password.trim() === "") {
      nextErrors.password = validationMessages.password;
    }

    setErrors(nextErrors);
    setFormError(undefined);
    setSuccess(undefined);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    submitting.current = true;
    setLoading(true);

    try {
      if (isRegister) {
        const result = await auth?.register?.({ email, password });

        if (result?.ok) {
          setSuccess("Tu cuenta fue creada. Ya podés iniciar sesión.");
          return;
        }

        const apiErrors = result === undefined ? {} : fieldErrors(result.error);
        setErrors(apiErrors);
        setFormError("No pudimos crear tu cuenta con esos datos.");
        return;
      }

      const result = await auth?.login?.({ email, password });

      if (result?.ok) {
        await onAuthenticated?.(result.value);
        return;
      }

      const apiErrors = result === undefined ? {} : fieldErrors(result.error);
      setErrors(apiErrors);
      setFormError("No pudimos iniciar sesión con esas credenciales.");
    } catch {
      setFormError(isRegister ? "No pudimos crear tu cuenta con esos datos." : "No pudimos iniciar sesión con esas credenciales.");
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <main className="app-shell access-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow" id="auth-title">{title}</p>
        <h1>{heading}</h1>
        <p className="auth-help">{help}</p>
        {!isRegister && sessionExpired ? <Feedback variant="info">{sessionExpiredNotice}</Feedback> : null}
        <form className="auth-form" noValidate onSubmit={submit}>
          <TextField label="Email" name="email" type="email" autoComplete="email" error={errors.email} loading={loading} />
          <PasswordField
            key={mode}
            label="Contraseña"
            name="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            error={errors.password}
            loading={loading}
          />
          {isRegister ? <p className="auth-note">Podés agregar tu nombre y foto después, desde tu perfil.</p> : null}
          {formError ? <Feedback variant="error">{formError}</Feedback> : null}
          {success ? <Feedback variant="success">{success}</Feedback> : null}
          <Button type="submit" loading={loading} loadingLabel="Enviando…">{title}</Button>
        </form>
        <p className="auth-switch">
          {isRegister ? "¿Ya tenés cuenta?" : "¿Todavía no tenés cuenta?"}{" "}
          <Link to={isRegister ? "/login" : "/register"} state={location.state}>
            {isRegister ? "Iniciar sesión" : "Crear cuenta"}
          </Link>
        </p>
      </section>
    </main>
  );
}
