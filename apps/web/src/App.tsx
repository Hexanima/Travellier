import { Preferences } from '@capacitor/preferences'
import { useCallback, useEffect, useRef } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'

import './App.css'
import { createHttpClient } from './api/index.js'
import { AuthScreen } from './auth/AuthScreen.js'
import { createAuthApi, type AuthApi, type AuthenticatedSession } from './auth/auth-api.js'
import { createNativeSessionStorage, type NativeSessionStorage } from './auth/native-session-storage.js'
import { Button } from './components/index.js'
import { AppUrlListener } from './navigation/AppUrlListener.js'

type AppProps = {
  auth?: Partial<AuthApi>
  apiBaseUrl?: string
  sessionStorage?: NativeSessionStorage
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

function App({ auth, apiBaseUrl = import.meta.env.VITE_API_BASE_URL, sessionStorage }: AppProps) {
  const navigate = useNavigate()
  const session = useRef<AuthenticatedSession | undefined>(undefined)
  const defaultAuth = useRef<AuthApi | undefined>(undefined)
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
      },
    })
    defaultAuth.current = createAuthApi(client)
  }

  const activeAuth = auth ?? defaultAuth.current

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
        return
      }

      if (result?.error.kind === 'unauthorized') {
        await queueStorageOperation(() => storage.clear())
        return
      }

      session.current = persistedSession
    }

    void restoreSession()
  }, [activeAuth, hasApiConfiguration, queueStorageOperation, storage])

  const onAuthenticated = async (authenticatedSession: AuthenticatedSession) => {
    sessionRevision.current += 1
    await queueStorageOperation(() => storage.save(authenticatedSession))
    session.current = authenticatedSession
    navigate('/trips')
  }

  const onLocalLogout = async () => {
    sessionRevision.current += 1
    session.current = undefined
    await queueStorageOperation(() => storage.clear())
    navigate('/login')
  }

  if (!hasApiConfiguration) {
    return <ApiConfigurationError />
  }

  return (
    <>
      <AppUrlListener />
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<AuthScreen auth={activeAuth} mode="login" onAuthenticated={onAuthenticated} />} />
        <Route path="/register" element={<AuthScreen auth={activeAuth} mode="register" />} />
        <Route path="/trips/*" element={<ProtectedRoute onLocalLogout={onLocalLogout} />} />
        <Route path="/profile" element={<ProtectedRoute onLocalLogout={onLocalLogout} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
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
