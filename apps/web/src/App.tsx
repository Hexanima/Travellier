import { useRef } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'

import './App.css'
import { createHttpClient } from './api/index.js'
import { AuthScreen } from './auth/AuthScreen.js'
import { createAuthApi, type AuthApi, type AuthenticatedSession } from './auth/auth-api.js'
import { AppUrlListener } from './navigation/AppUrlListener.js'

type AppProps = {
  auth?: Partial<AuthApi>
  apiBaseUrl?: string
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

function App({ auth, apiBaseUrl = import.meta.env.VITE_API_BASE_URL }: AppProps) {
  const navigate = useNavigate()
  const session = useRef<AuthenticatedSession | undefined>(undefined)
  const defaultAuth = useRef<AuthApi | undefined>(undefined)

  if (auth === undefined && !isHttpApiBaseUrl(apiBaseUrl)) {
    return <ApiConfigurationError />
  }

  if (auth === undefined && defaultAuth.current === undefined) {
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

  const onAuthenticated = (authenticatedSession: AuthenticatedSession) => {
    session.current = authenticatedSession
    navigate('/trips')
  }

  return (
    <>
      <AppUrlListener />
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<AuthScreen auth={auth ?? defaultAuth.current} mode="login" onAuthenticated={onAuthenticated} />} />
        <Route path="/register" element={<AuthScreen auth={auth ?? defaultAuth.current} mode="register" />} />
        <Route path="/trips/*" element={<ProtectedRoute />} />
        <Route path="/profile" element={<ProtectedRoute />} />
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

function ProtectedRoute() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Travellier</p>
        <h1>Acceso protegido</h1>
        <p className="domain-check">La sesión se integrará en el flujo de autenticación.</p>
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
