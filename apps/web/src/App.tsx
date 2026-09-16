import { Route, Routes } from 'react-router-dom'

import './App.css'
import { AppUrlListener } from './navigation/AppUrlListener.js'

function App() {
  return (
    <>
      <AppUrlListener />
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/trips/*" element={<ProtectedRoute />} />
        <Route path="/profile" element={<ProtectedRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}

function PublicHome() {
  return (
    <main className="app-shell">
      <section className="status-panel">
        <p className="eyebrow">Viajes en grupo</p>
        <h1>Travellier</h1>
        <p className="domain-check">Inicio</p>
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
