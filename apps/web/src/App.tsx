import { Preferences } from '@capacitor/preferences'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import './App.css'
import { createHttpClient } from './api/index.js'
import { AuthScreen } from './auth/AuthScreen.js'
import { createAuthApi, type AuthApi, type AuthenticatedSession } from './auth/auth-api.js'
import { createNativeSessionStorage, type NativeSessionStorage } from './auth/native-session-storage.js'
import { Button, LoadingState } from './components/index.js'
import { AppUrlListener } from './navigation/AppUrlListener.js'
import type { NativeAppUrlApi } from './navigation/app-url-listener.js'
import { ProfileScreen } from './profile/ProfileScreen.js'
import { createTripInvitationApi, type TripInvitationApi, type TripJoinResponse } from './trips/trip-invitation-api.js'

type AppProps = {
  auth?: Partial<AuthApi>
  apiBaseUrl?: string
  sessionStorage?: NativeSessionStorage
  nativeApp?: NativeAppUrlApi
  trips?: Partial<TripInvitationApi>
}

const invitationDestination = (state: unknown): string | null => {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null
  const from = state.from
  return typeof from === 'string' && /^\/invite\/[^/?#]+(?:\?[^#]*)?$/.test(from) ? from : null
}

const isHttpApiBaseUrl = (value: string | undefined): value is string => {
  if (value === undefined) {
    return false
  }

  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function App({ auth, apiBaseUrl = import.meta.env.VITE_API_BASE_URL, sessionStorage, nativeApp, trips }: AppProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const latestLocation = useRef(location)
  latestLocation.current = location
  const session = useRef<AuthenticatedSession | undefined>(undefined)
  const [sessionReady, setSessionReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  const [launchChecked, setLaunchChecked] = useState(false)
  const deepLinkReceived = useRef(false)
  const defaultAuth = useRef<AuthApi | undefined>(undefined)
  const defaultTrips = useRef<TripInvitationApi | undefined>(undefined)
  const defaultSessionStorage = useRef<NativeSessionStorage | undefined>(undefined)
  const restoredSession = useRef(false)
  const sessionRevision = useRef(0)
  const storageOperations = useRef<Promise<void>>(Promise.resolve())
  const storage = sessionStorage ?? (defaultSessionStorage.current ??= createNativeSessionStorage(Preferences))
  const hasApiConfiguration = auth !== undefined || isHttpApiBaseUrl(apiBaseUrl)
  const queueStorageOperation = useCallback((operation: () => Promise<void>) => {
    const next = storageOperations.current.then(operation, operation)

    storageOperations.current = next.catch(() => undefined)
    return next
  }, [])

  if (auth === undefined && hasApiConfiguration && defaultAuth.current === undefined) {
    const client = createHttpClient({
      baseUrl: apiBaseUrl,
      fetch: (input, init) => globalThis.fetch(input, init),
      getAccessToken: async () => session.current?.accessToken ?? null,
      onUnauthorized: () => {
        session.current = undefined
        setHasSession(false)
      },
    })
    defaultAuth.current = createAuthApi(client)
    defaultTrips.current = createTripInvitationApi(client)
  }

  const activeAuth = auth ?? defaultAuth.current
  const activeTrips = trips ?? defaultTrips.current

  useEffect(() => {
    if (!hasApiConfiguration || restoredSession.current) {
      return
    }

    restoredSession.current = true

    const restoreSession = async () => {
      const restorationRevision = sessionRevision.current
      const persistedSession = await storage.read()

      if (persistedSession === null || sessionRevision.current !== restorationRevision) {
        return
      }

      const result = await activeAuth?.refresh?.({
        refreshToken: persistedSession.refreshToken,
      })

      if (sessionRevision.current !== restorationRevision) {
        return
      }

      if (result?.ok) {
        await queueStorageOperation(() => storage.save(result.value))

        if (sessionRevision.current !== restorationRevision) {
          return
        }

        session.current = result.value
        setHasSession(true)
        return
      }

      if (result?.error.kind === 'unauthorized') {
        await queueStorageOperation(() => storage.clear())
        return
      }

      session.current = persistedSession
      setHasSession(true)
    }

    void restoreSession().catch(() => undefined).finally(() => setSessionReady(true))
  }, [activeAuth, hasApiConfiguration, navigate, queueStorageOperation, storage])

  useEffect(() => {
    if (sessionReady && launchChecked && hasSession && !deepLinkReceived.current &&
      (location.pathname === '/' || location.pathname === '/login')) {
      navigate(invitationDestination(location.state) ?? '/trips', { replace: true })
    }
  }, [hasSession, launchChecked, location.pathname, location.state, navigate, sessionReady])

  const onAuthenticated = async (authenticatedSession: AuthenticatedSession) => {
    sessionRevision.current += 1
    await queueStorageOperation(() => storage.save(authenticatedSession))
    session.current = authenticatedSession
    setHasSession(true)
    setSessionReady(true)
    navigate(invitationDestination(latestLocation.current.state) ?? '/trips', { replace: true })
  }

  const onLocalLogout = async () => {
    sessionRevision.current += 1
    session.current = undefined
    setHasSession(false)
    await queueStorageOperation(() => storage.clear())
    navigate('/login')
  }

  if (!hasApiConfiguration) {
    return <ApiConfigurationError />
  }

  return (
    <>
      <AppUrlListener nativeApp={nativeApp} onNavigate={() => { deepLinkReceived.current = true }} onReady={() => setLaunchChecked(true)} />
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<AuthScreen auth={activeAuth} mode="login" onAuthenticated={onAuthenticated} />} />
        <Route path="/register" element={<AuthScreen auth={activeAuth} mode="register" />} />
        <Route path="/invite/:code" element={<InviteRoute sessionReady={sessionReady} hasSession={hasSession} trips={activeTrips} />} />
        <Route path="/verify/:token" element={<VerificationScreen />} />
        <Route path="/trips/*" element={<ProtectedRoute onLocalLogout={onLocalLogout} />} />
        <Route path="/profile" element={
          !sessionReady
            ? <main className="app-shell"><LoadingState label="Restaurando sesión…" /></main>
            : hasSession
              ? <ProfileScreen auth={activeAuth} />
              : <Navigate to="/login" replace />
        } />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}

type InviteEntryProps = { sessionReady: boolean; hasSession: boolean; trips?: Partial<TripInvitationApi> }

function InviteRoute(props: InviteEntryProps) {
  const { code } = useParams()
  return <InviteEntry key={code} code={code} {...props} />
}

function InviteEntry({ sessionReady, hasSession, trips, code }: InviteEntryProps & { code?: string }) {
  const location = useLocation()
  const destination = `${location.pathname}${location.search}`
  const [joining, setJoining] = useState(false)
  const [result, setResult] = useState<TripJoinResponse>()

  const confirmJoin = async () => {
    if (!code || joining) return
    setJoining(true)
    try {
      setResult(await trips?.joinByCode?.(code) ?? { ok: false, error: { kind: 'server' } })
    } catch {
      setResult({ ok: false, error: { kind: 'network' } })
    } finally {
      setJoining(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Invitación</p>
        <h1>Unirse a un viaje</h1>
        <p>Tu código de invitación: <strong>{code}</strong></p>
        {!sessionReady
          ? <LoadingState label="Restaurando sesión…" />
          : !hasSession
            ? <p>Iniciá sesión para continuar. <Link to="/login" state={{ from: destination }}>Iniciar sesión</Link></p>
            : result?.ok
              ? <><p>{result.value.joined ? 'Te uniste al viaje.' : 'Ya sos parte de este viaje.'}</p><Link to="/trips">Volver a viajes</Link></>
              : <>
                  <Button onClick={() => void confirmJoin()} loading={joining} loadingLabel="Confirmando…">Confirmar unión</Button>
                  {result && !result.ok
                    ? <p role="alert">{result.error.kind === 'not-found' ? 'El código de invitación no es válido.' : 'No pudimos confirmar la unión. Intentá nuevamente.'}</p>
                    : null}
                </>}
      </section>
    </main>
  )
}

function VerificationScreen() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Cuenta</p>
        <h1>Verificación de email</h1>
        <p>El enlace de verificación abrió Travellier.</p>
        <Link to="/login">Iniciar sesión</Link>
      </section>
    </main>
  )
}

function ApiConfigurationError() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Travellier</p>
        <h1>Configuración de API requerida</h1>
        <p className="domain-check">Definí una URL HTTP(S) en VITE_API_BASE_URL antes de generar la app mobile.</p>
      </section>
    </main>
  )
}

function PublicHome() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Viajes en grupo</p>
        <h1>Travellier</h1>
        <p className="domain-check">Inicio</p>
        <p className="auth-links">
          <Link to="/login">Iniciar sesión</Link>
          <Link to="/register">Crear cuenta</Link>
        </p>
      </section>
    </main>
  )
}

function ProtectedRoute({ onLocalLogout }: { onLocalLogout: () => Promise<void> }) {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Travellier</p>
        <h1>Acceso protegido</h1>
        <p className="domain-check">La sesión se integrará en el flujo de autenticación.</p>
        <Link to="/profile">Mi perfil</Link>
        <Button onClick={() => void onLocalLogout()}>Cerrar sesión</Button>
      </section>
    </main>
  )
}

function NotFound() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Travellier</p>
        <h1>Página no encontrada</h1>
      </section>
    </main>
  )
}

export default App
