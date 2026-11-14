import { useCallback } from "react";
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, PullToRefresh, Tabs, type TabItem } from "../components/index.js";
import { useHasTripRefresh, useRefreshNow } from "./trip-refresh.js";
import { ShellFrame } from "./trip-context.js";
import { useTripName } from "./trip-state.js";
import { canGoBack, noticesOrigin, originLabel, readOrigin, withNoBack } from "./post-origin.js";
import { rootTabOf, tabPath, type DiaryPanel, type TripTab } from "./trip-tabs.js";
import "./itinerary.css";

const tabs: readonly TabItem[] = [{ id: "itinerary", label: "Itinerario" }, { id: "diary", label: "Diario" }, { id: "group", label: "Grupo" }];
const panels: readonly TabItem[] = [{ id: "posts", label: "Posts" }, { id: "photos", label: "Fotos" }];

/**
 * Frame of the Trip: on the root screen of a tab it provides `<main>`, the way back, the Trip name and the tabs (Posts/Fotos inside the diary);
 * anywhere else (details, forms, balance, journey…) only the child route is rendered, outside the tabs. Mounted under the Trip providers.
 */
export function TripShell() {
  const { tripId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const name = useTripName();
  const hasRefresh = useHasTripRefresh();
  const refreshNow = useRefreshNow();
  const root = rootTabOf(location.pathname, tripId);
  const select = useCallback((tab: TripTab, panel?: DiaryPanel) => {
    // The entry is replaced so the tabs never pile up history: Back from a root screen leaves to Mis viajes.
    // `noBack` (nothing behind) and the notices origin travel with the entry; nothing else does.
    const fromNotices = readOrigin(location.state, tripId ?? "").label === "avisos";
    const kept = fromNotices ? { origin: noticesOrigin } : undefined;
    navigate(tabPath(tripId ?? "", tab, panel), { replace: true, state: canGoBack(location) ? kept ?? null : withNoBack(kept) });
    window.scrollTo?.(0, 0);
  }, [location, navigate, tripId]);
  if (!root) return <Outlet />;
  const fromNotices = readOrigin(location.state, tripId ?? "").label === "avisos";
  // The listings refresh on a pull and on the visible «Actualizar» button (the accessible alternative to the gesture); both only exist with the refresh provider.
  // The button accompanies the Trip name instead of opening the body: below the tabs it read as a fourth tab and pushed the listing down.
  const framedOutlet = <ShellFrame><Outlet /></ShellFrame>;
  const content = hasRefresh ? <PullToRefresh onRefresh={refreshNow}>{framedOutlet}</PullToRefresh> : framedOutlet;
  return <main className="app-shell trips-shell itinerary-shell trip-shell">
    <div className="trips-panel">
      {/* Opened from the notices center (the origin travels in the entry state): the way back is that center, never another Trip. */}
      {fromNotices ? <Link className="trips-back" to={noticesOrigin.path}>{originLabel("avisos")}</Link> : <Link className="trips-back" to="/trips">Volver a mis viajes</Link>}
      <header className="trip-shell-header">
        <h1>{name || "Viaje"}</h1>
        {hasRefresh ? <Button className="trip-shell-refresh" onClick={() => { void refreshNow(); }}>Actualizar</Button> : null}
        {/* La configuración del viaje se abre desde su cabecera (prototipo aprobado), disponible para cualquier integrante y sin repetirse en la tarjeta de Mis viajes. */}
        <Link className="trip-shell-settings" to={`/trips/${tripId ?? ""}/config`} aria-label="Configuración del viaje">Configuración</Link>
      </header>
      <Tabs idPrefix="trip-tab" label="Secciones del viaje" items={tabs} selected={root.tab}
        onSelect={(id) => { if (id !== root.tab) select(id as TripTab); }}>
        {root.tab === "diary"
          ? <Tabs idPrefix="trip-diary" label="Contenido del diario" items={panels} selected={root.panel}
            onSelect={(id) => { if (id !== root.panel) select("diary", id as DiaryPanel); }}>{content}</Tabs>
          : content}
      </Tabs>
    </div>
  </main>;
}
