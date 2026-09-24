import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { AuthApi, AuthenticatedProfile } from "../auth/auth-api.js";
import { Button, Feedback, LoadingState, TextField } from "../components/index.js";

type ProfileScreenProps = { auth?: Partial<AuthApi>; ready?: boolean };

export function ProfileScreen({ auth, ready = true }: ProfileScreenProps) {
  const [profile, setProfile] = useState<AuthenticatedProfile>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [nameError, setNameError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>();
  const [selectedFile, setSelectedFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();

  const showAvatar = useCallback(async (current: AuthenticatedProfile) => {
    if (current.avatar === null) {
      setAvatarUrl(undefined);
      return;
    }
    const result = await auth?.getAvatarUrl?.();
    setAvatarUrl(result?.ok ? result.value.url ?? undefined : undefined);
  }, [auth]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    try {
      const result = await auth?.getProfile?.();
      if (result?.ok) {
        setProfile(result.value);
        await showAvatar(result.value);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [auth, showAvatar]);

  useEffect(() => {
    if (!ready) return;
    void loadProfile();
  }, [loadProfile, ready]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name") ?? "").trim();
    setNameError(undefined);
    setSaveError(false);
    setSuccess(false);

    if (name === "") {
      setNameError("Ingresá tu nombre.");
      return;
    }

    if (fileError !== undefined) return;

    setSaving(true);
    try {
      let avatar: string | undefined;
      if (selectedFile !== undefined) {
        const uploaded = await auth?.uploadAvatar?.(selectedFile);
        if (!uploaded?.ok) {
          setSaveError(true);
          return;
        }
        avatar = uploaded.value.avatar;
      }

      const result = await auth?.updateProfile?.(avatar === undefined ? { name } : { name, avatar });
      if (!result?.ok) {
        setNameError(result?.error.fields?.find((field) => field.field === "name")?.message);
        setSaveError(true);
        return;
      }

      const refreshed = await auth?.getProfile?.();
      if (!refreshed?.ok) {
        setSaveError(true);
        return;
      }

      setProfile(refreshed.value);
      await showAvatar(refreshed.value);
      setSelectedFile(undefined);
      const fileInput = form.querySelector('input[type="file"]') as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      setSuccess(true);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="app-shell">
      <section className="auth-panel" aria-labelledby="profile-title">
        <p className="eyebrow">Travellier</p>
        <h1 id="profile-title">Mi perfil</h1>
        <p><Link to="/trips">Volver a viajes</Link></p>
        {loading ? <LoadingState label="Cargando perfil…" /> : null}
        {loadError ? (
          <>
            <Feedback variant="error">No pudimos cargar tu perfil.</Feedback>
            <Button onClick={() => void loadProfile()}>Reintentar</Button>
          </>
        ) : null}
        {profile ? (
          <form className="auth-form" onSubmit={(event) => void submit(event)} noValidate>
            {avatarUrl ? <img className="profile-avatar" src={avatarUrl} alt="Foto de perfil" /> : <div className="profile-avatar profile-avatar--empty" aria-label="Sin foto de perfil">Sin foto</div>}
            <TextField key={profile.name} label="Nombre" name="name" defaultValue={profile.name} autoComplete="name" error={nameError} loading={saving} />
            <p>Email: {profile.email}</p>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor="profile-avatar">Foto de perfil</label>
              <input
                id="profile-avatar" type="file" className="ui-control" accept="image/jpeg,image/png,image/webp"
                disabled={saving}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  setSelectedFile(file);
                  setFileError(file !== undefined && !["image/jpeg", "image/png", "image/webp"].includes(file.type)
                    ? "Elegí una imagen JPG, PNG o WebP."
                    : file !== undefined && file.size > 5 * 1024 * 1024
                      ? "La foto debe pesar menos de 5 MB."
                      : undefined);
                  setSuccess(false);
                }}
                aria-invalid={fileError !== undefined}
                aria-describedby={fileError ? "profile-avatar-error" : undefined}
              />
              {fileError ? <p id="profile-avatar-error" className="ui-field__error" role="alert">{fileError}</p> : null}
            </div>
            {saveError ? <Feedback variant="error">No pudimos guardar tu perfil. Intentá nuevamente.</Feedback> : null}
            {success ? <Feedback variant="success">Perfil guardado correctamente.</Feedback> : null}
            <Button type="submit" loading={saving}>Guardar cambios</Button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
