import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import { Button, Feedback, TextField } from "../components/index.js";
import type { AuthApi, AuthenticatedSession, AuthFailure } from "./auth-api.js";

export type AuthScreenMode = "login" | "register";

type AuthScreenProps = {
  auth?: Partial<AuthApi>;
  mode: AuthScreenMode;
  onAuthenticated?: (session: AuthenticatedSession) => void;
};

const validationMessages = {
  email: "Ingresá un email válido.",
  name: "Ingresá tu nombre.",
  password: "Ingresá una contraseña.",
};

const fieldErrors = (error: AuthFailure): Record<string, string> =>
  Object.fromEntries((error.fields ?? []).map(({ field, message }) => [field, message]));

export function AuthScreen({ auth, mode, onAuthenticated }: AuthScreenProps) {
  const isRegister = mode === "register";
  const title = isRegister ? "Crear cuenta" : "Iniciar sesión";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "");
    const name = String(values.get("name") ?? "");
    const password = String(values.get("password") ?? "");
    const nextErrors: Record<string, string> = {};

    if (email.trim() === "" || !email.includes("@")) {
      nextErrors.email = validationMessages.email;
    }

    if (isRegister && name.trim() === "") {
      nextErrors.name = validationMessages.name;
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

    setLoading(true);

    try {
      if (isRegister) {
        const result = await auth?.register?.({ email, name, password });

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
        onAuthenticated?.(result.value);
        return;
      }

      const apiErrors = result === undefined ? {} : fieldErrors(result.error);
      setErrors(apiErrors);
      setFormError("No pudimos iniciar sesión con esas credenciales.");
    } catch {
      setFormError(isRegister ? "No pudimos crear tu cuenta con esos datos." : "No pudimos iniciar sesión con esas credenciales.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">Travellier</p>
        <h1 id="auth-title">{title}</h1>
        <form className="auth-form" noValidate onSubmit={submit}>
          {isRegister ? <TextField label="Nombre" name="name" autoComplete="name" error={errors.name} loading={loading} /> : null}
          <TextField label="Email" name="email" type="email" autoComplete="email" error={errors.email} loading={loading} />
          <TextField
            label="Contraseña"
            name="password"
            type="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            error={errors.password}
            loading={loading}
          />
          {formError ? <Feedback variant="error">{formError}</Feedback> : null}
          {success ? <Feedback variant="success">{success}</Feedback> : null}
          <Button type="submit" loading={loading} loadingLabel="Enviando…">{title}</Button>
        </form>
        <p className="auth-switch">
          {isRegister ? "¿Ya tenés cuenta?" : "¿Todavía no tenés cuenta?"}{" "}
          <Link to={isRegister ? "/login" : "/register"}>
            {isRegister ? "Iniciar sesión" : "Crear cuenta"}
          </Link>
        </p>
      </section>
    </main>
  );
}
