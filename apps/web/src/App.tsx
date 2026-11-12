import { Capacitor } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'

import './App.css'
import { createDirectUpload } from './api/direct-upload.js'
import { createHttpClient } from './api/index.js'
import { AuthScreen } from './auth/AuthScreen.js'
import { createAuthApi, type AuthApi, type AuthenticatedSession } from './auth/auth-api.js'
import { createNativeSessionStorage, type NativeSessionStorage } from './auth/native-session-storage.js'
import { Button, Feedback, LoadingState } from './components/index.js'
import { AppUrlListener } from './navigation/AppUrlListener.js'
import type { NativeAppUrlApi } from './navigation/app-url-listener.js'
import { capacitorAppLifecycle, type AppLifecycle } from './native/app-lifecycle.js'
import { createCapacitorCapabilities } from './native/capacitor-capabilities.js'
import { ExternalLinkContext } from './trips/external-link-context.js'
import { createPhotoFileReader } from './native/photo-file.js'
import { NotificationsScreen } from './notifications/NotificationsScreen.js'
import { createNotificationOpener, type NotificationOpener, type SessionStatus } from './notifications/notification-opener.js'
import { createTripNotificationApi, type TripNotificationApi } from './notifications/trip-notification-api.js'
import type { ExternalLinkPort, PushRegistrationPort } from 'app-domain'
import { ProfileScreen } from './profile/ProfileScreen.js'
import { PushNotices } from './push/PushNotices.js'
import { createPushDeviceApi, type PushDeviceApi } from './push/push-device-api.js'
import { createPushDeviceService, type PushDeviceService } from './push/push-device-service.js'
import { accountIdFromAccessToken } from './calendar/calendar-account.js'
import { createCalendarRefStore } from './calendar/calendar-ref-store.js'
import { createCalendarSyncService, type CalendarSyncService } from './calendar/calendar-sync-service.js'
import { createTripInvitationApi, type TripInvitationApi, type TripJoinResponse } from './trips/trip-invitation-api.js'
import { createTripJourneyApi, type TripJourneyApi } from './trips/trip-journey-api.js'
import { TripConfigurationScreen } from './trips/TripConfigurationScreen.js'
import { TripJourneyScreen } from './trips/TripJourneyScreen.js'
import { TripItineraryScreen } from './trips/TripItineraryScreen.js'
import { createTripItineraryApi, type TripItineraryApi } from './trips/trip-itinerary-api.js'
import { createTripActivityApi, type TripActivityApi } from './trips/trip-activity-api.js'
import { createTripParticipationApi, type TripParticipationApi } from './trips/trip-participation-api.js'
import { PublicTripConfirmationScreen, TripExploreScreen } from './trips/TripExploreScreen.js'
import { TripJoinScreen } from './trips/TripJoinScreen.js'
import { TripMembersScreen } from './trips/TripMembersScreen.js'
import { CreateTripScreen, TripsListScreen } from './trips/TripScreens.js'
import { resetRememberedFilter } from './trips/trips-filter-memory.js'
import { createTripManagementApi, type TripManagementApi } from './trips/trip-management-api.js'
import { createTripMembersApi, type TripMembersApi } from './trips/trip-members-api.js'
import { createTripPostApi, type TripPostApi } from './trips/trip-post-api.js'
import { createTripCommentApi, type TripCommentApi } from './trips/trip-comment-api.js'
import { createTripLikeApi, type TripLikeApi } from './trips/trip-like-api.js'
import { createTripBalanceApi, type TripBalanceApi } from './trips/trip-balance-api.js'
import { TripBalanceScreen } from './trips/TripBalanceScreen.js'
import { createTripPhotoApi, type TripPhotoApi } from './trips/trip-photo-api.js'
import { createTripGalleryApi, type TripGalleryApi } from './trips/trip-gallery-api.js'
import { TripPhotosScreen } from './trips/TripPhotosScreen.js'
import type { PostPhotoDeps } from './trips/use-post-photos.js'
import { PostComposer } from './trips/PostComposer.js'
import { PostLinkPicker } from './trips/PostLinkPicker.js'
import { SpontaneousActivityForm } from './trips/SpontaneousActivityForm.js'
import { ExpenseForm } from './trips/ExpenseForm.js'
import { ExpenseSplitForm } from './trips/ExpenseSplitForm.js'
import { MemoriesLayout, TripMemoriesScreen } from './trips/TripMemoriesScreen.js'
import { TripContentLayout } from './trips/TripContentLayout.js'
import { PostDetailScreen } from './trips/PostDetailScreen.js'

type AppProps = {
  auth?: Partial<AuthApi>
  apiBaseUrl?: string
  sessionStorage?: NativeSessionStorage
  nativeApp?: NativeAppUrlApi
  trips?: Partial<TripInvitationApi & TripManagementApi>
  journey?: Partial<TripJourneyApi>
  members?: Partial<TripMembersApi>
  itinerary?: Partial<TripItineraryApi>
  activities?: Partial<TripActivityApi>
  participations?: Partial<TripParticipationApi>
  posts?: Partial<TripPostApi>
  comments?: Partial<TripCommentApi>
  likes?: Partial<TripLikeApi>
  /** Balance of the Trip computed by the backend; the default uses the authenticated client. */
  balance?: Partial<TripBalanceApi>
  /** Reservation of photo uploads; the default uses the authenticated client. */
  photos?: Partial<TripPhotoApi>
  /** Gallery of the Trip photos (signed read urls); the default uses the authenticated client. */
  gallery?: Partial<TripGalleryApi>
  /** Device side of the photo upload (picker, file reader, direct transfer); the defaults are the Capacitor ones and request no permission until used. */
  devicePhotos?: Partial<Omit<PostPhotoDeps, 'api'>>
  /** Push registration service; by default it exists only on a native platform and nothing runs until there is a session. */
  push?: PushDeviceService
  /** Push device endpoints; the default uses the authenticated client. */
  pushDevices?: Partial<PushDeviceApi>
  /** Personal notices (GET /notifications); the default uses the authenticated client. */
  notifications?: Partial<TripNotificationApi>
  /** Port the notice opener listens on; by default it exists only on a native platform (inert on the web). */
  noticePort?: Pick<PushRegistrationPort, 'listen'>
  /** Opens a location link outside the app; the default is the Capacitor adapter and does nothing until a person taps `Abrir en Maps`. */
  externalLink?: ExternalLinkPort
  /** Native calendar sync; by default it exists only on a native platform (inert on the web) and nothing runs until the person enables it. */
  calendarSync?: CalendarSyncService
  /** Resume signal of the app for the Trip refresh (T121); by default the Capacitor `appStateChange` on a native platform, nothing on the web (it uses `visibilitychange`/`focus`). */
  lifecycle?: AppLifecycle
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

function App({ auth, apiBaseUrl = import.meta.env.VITE_API_BASE_URL, sessionStorage, nativeApp, trips, journey, members, itinerary, activities, participations, posts, comments, likes, balance, photos, gallery, devicePhotos, push, pushDevices, notifications, noticePort, externalLink, calendarSync, lifecycle }: AppProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const latestLocation = useRef(location)
  latestLocation.current = location
  const session = useRef<AuthenticatedSession | undefined>(undefined)
  const [sessionReady, setSessionReady] = useState(false)
  const [hasSession, setHasSession] = useState(false)
  // True only after a real 401 ended an active session; cleared when a session starts or is closed on purpose.
  const [sessionExpired, setSessionExpired] = useState(false)
  const [launchChecked, setLaunchChecked] = useState(false)
  const deepLinkReceived = useRef(false)
  const defaultAuth = useRef<AuthApi | undefined>(undefined)
  const defaultTrips = useRef<(TripInvitationApi & TripManagementApi) | undefined>(undefined)
  const defaultJourney = useRef<TripJourneyApi | undefined>(undefined)
  const defaultMembers = useRef<TripMembersApi | undefined>(undefined)
  const defaultItinerary = useRef<TripItineraryApi | undefined>(undefined)
  const defaultActivities = useRef<TripActivityApi | undefined>(undefined)
  const defaultParticipations = useRef<TripParticipationApi | undefined>(undefined)
  const defaultPosts = useRef<TripPostApi | undefined>(undefined)
  const defaultComments = useRef<TripCommentApi | undefined>(undefined)
  const defaultLikes = useRef<TripLikeApi | undefined>(undefined)
  const defaultBalance = useRef<TripBalanceApi | undefined>(undefined)
  const defaultPhotos = useRef<TripPhotoApi | undefined>(undefined)
  const defaultGallery = useRef<TripGalleryApi | undefined>(undefined)
  const defaultDevicePhotos = useRef<Partial<Omit<PostPhotoDeps, 'api'>>>({})
  const defaultPushDevices = useRef<PushDeviceApi | undefined>(undefined)
  const defaultNotifications = useRef<TripNotificationApi | undefined>(undefined)
  const opener = useRef<NotificationOpener | undefined>(undefined)
  // Bumped when a notice arrives in the foreground: the open center reloads and, elsewhere, a non intrusive announcement appears.
  const [noticeSignal, setNoticeSignal] = useState(0)
  const [noticeAnnounced, setNoticeAnnounced] = useState(false)
  const defaultPush = useRef<PushDeviceService | undefined>(undefined)
  const defaultCalendarSync = useRef<CalendarSyncService | undefined>(undefined)
  const pushRef = useRef<PushDeviceService | undefined>(undefined)
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
      onUnauthorized: (requestAccessToken) => {
        // A late 401 of a request made by an outgoing session (e.g. the logout revoke) must not close the active one.
        if (requestAccessToken !== (session.current?.accessToken ?? null)) return
        // A 401 leaves no authentication to revoke with: forget the push registration locally.
        pushRef.current?.reset()
        // The rejected session is over: neither its foreground announcement nor an action waiting for a session survives it (it could be opened by another account).
        const hadSession = session.current !== undefined
        if (hadSession) opener.current?.discard()
        setNoticeAnnounced(false)
        session.current = undefined
        resetRememberedFilter()
        if (hadSession) setSessionExpired(true)
        setHasSession(false)
      },
    })
    defaultAuth.current = createAuthApi(client)
    defaultTrips.current = { ...createTripInvitationApi(client), ...createTripManagementApi(client) }
    defaultJourney.current = createTripJourneyApi(client)
    defaultMembers.current = createTripMembersApi(client)
    defaultItinerary.current = createTripItineraryApi(client)
    defaultActivities.current = createTripActivityApi(client)
    defaultParticipations.current = createTripParticipationApi(client)
    defaultPosts.current = createTripPostApi(client)
    defaultComments.current = createTripCommentApi(client)
    defaultLikes.current = createTripLikeApi(client)
    defaultBalance.current = createTripBalanceApi(client)
    defaultPhotos.current = createTripPhotoApi(client)
    defaultGallery.current = createTripGalleryApi(client)
    defaultPushDevices.current = createPushDeviceApi(client)
    defaultNotifications.current = createTripNotificationApi(client)
  }

  const activeAuth = auth ?? defaultAuth.current
  const activeTrips = trips ?? defaultTrips.current
  const activeJourney = journey ?? defaultJourney.current
  const activeMembers = members ?? defaultMembers.current
  const activeItinerary = itinerary ?? defaultItinerary.current
  const activeActivities = activities ?? defaultActivities.current
  const activeParticipations = participations ?? defaultParticipations.current
  const activePosts = posts ?? defaultPosts.current
  const activeComments = comments ?? defaultComments.current
  const activeLikes = likes ?? defaultLikes.current
  const activeBalance = balance ?? defaultBalance.current
  const activePhotos = photos ?? defaultPhotos.current
  const activeGallery = gallery ?? defaultGallery.current
  const activeNotifications = notifications ?? defaultNotifications.current
  // Stable reference: the notices hook depends on it.
  const tripNotifications = useMemo<TripNotificationApi>(() => ({
    list: activeNotifications?.list ?? (async () => ({ ok: false as const, error: { kind: 'server' as const } })),
  }), [activeNotifications])
  // Inert outside a native platform; building the service has no plugin or permission side effects.
  if (push === undefined && defaultPush.current === undefined && Capacitor.isNativePlatform()) {
    const failed = async () => ({ ok: false as const, error: { kind: 'server' as const } })
    defaultPush.current = createPushDeviceService({
      port: createCapacitorCapabilities().push,
      api: {
        register: (input) => (pushDevices?.register ?? defaultPushDevices.current?.register ?? failed)(input),
        revoke: (input, options) => (pushDevices?.revoke ?? defaultPushDevices.current?.revoke ?? failed)(input, options),
      },
    })
  }
  // Building the service has no plugin, permission or Preferences side effect. The account is the `sub` of the session token (not verified: it only keys local data).
  if (calendarSync === undefined && defaultCalendarSync.current === undefined && Capacitor.isNativePlatform()) {
    const capabilities = createCapacitorCapabilities()
    defaultCalendarSync.current = createCalendarSyncService({
      access: capabilities.calendar,
      events: capabilities.calendarEvents,
      store: createCalendarRefStore(Preferences),
      accountId: () => accountIdFromAccessToken(session.current?.accessToken),
      now: () => new Date(),
    })
  }
  const activeCalendarSync = calendarSync ?? defaultCalendarSync.current
  const activePush = push ?? defaultPush.current
  pushRef.current = activePush
  // Stable reference: the gallery hook depends on it.
  const galleryProvider = useMemo(() => ({
    list: activeGallery?.list ?? (async () => ({ ok: false as const, error: { kind: 'server' as const } })),
  }), [activeGallery])
  const tripComments = useMemo<TripCommentApi>(() => ({
    list: activeComments?.list ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    create: activeComments?.create ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    update: activeComments?.update ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    remove: activeComments?.remove ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeComments])
  const tripLikes = useMemo<TripLikeApi>(() => ({
    summary: activeLikes?.summary ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    setPostLike: activeLikes?.setPostLike ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    setCommentLike: activeLikes?.setCommentLike ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeLikes])
  const tripBalance = useMemo<TripBalanceApi>(() => ({
    get: activeBalance?.get ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeBalance])
  const tripPosts = useMemo<TripPostApi>(() => ({
    list: activePosts?.list ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    get: activePosts?.get ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    create: activePosts?.create ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    update: activePosts?.update ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    remove: activePosts?.remove ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activePosts])
  const linkPort = useMemo(() => externalLink ?? createCapacitorCapabilities().externalLink, [externalLink])
  const appLifecycle = Capacitor.isNativePlatform() ? capacitorAppLifecycle : undefined
  // Without a reservation api there is no photo section. Device defaults are built on first need and request nothing at startup.
  const photoDeps = useMemo<PostPhotoDeps | undefined>(() => {
    const reserve = activePhotos?.reserve
    if (!reserve) return undefined
    const device = defaultDevicePhotos.current
    return {
      api: { reserve, ...(activePhotos.countForPost ? { countForPost: activePhotos.countForPost } : {}), ...(activePhotos.listForPost ? { listForPost: activePhotos.listForPost } : {}) },
      source: devicePhotos?.source ?? (device.source ??= createCapacitorCapabilities().photos),
      reader: devicePhotos?.reader ?? (device.reader ??= createPhotoFileReader({ fetch: (url) => globalThis.fetch(url), convertFileSrc: (reference) => Capacitor.convertFileSrc(reference) })),
      transfer: devicePhotos?.transfer ?? (device.transfer ??= createDirectUpload({ createXhr: () => new XMLHttpRequest() })),
      ...(devicePhotos?.now ? { now: devicePhotos.now } : {}),
    }
  }, [activePhotos, devicePhotos])
  const tripParticipations = useMemo<TripParticipationApi | undefined>(() => activeParticipations ? ({
    get: activeParticipations.get ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    set: activeParticipations.set ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }) : undefined, [activeParticipations])
  const tripActivities = useMemo<TripActivityApi>(() => ({
    create: activeActivities?.create ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    get: activeActivities?.get ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    update: activeActivities?.update ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    remove: activeActivities?.remove ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeActivities])
  const tripItinerary = useMemo<TripItineraryApi>(() => ({
    get: activeItinerary?.get ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeItinerary])
  const tripManagement = useMemo<TripManagementApi>(() => ({
    list: activeTrips?.list ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    listPublic: activeTrips?.listPublic ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    joinPublic: activeTrips?.joinPublic ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    create: activeTrips?.create ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    get: activeTrips?.get ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    deleteTrip: activeTrips?.deleteTrip ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    updateConfiguration: activeTrips?.updateConfiguration ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeTrips])
  const tripMembers = useMemo<TripMembersApi>(() => ({
    list: activeMembers?.list ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    expel: activeMembers?.expel ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    setRole: activeMembers?.setRole ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    transferOwnership: activeMembers?.transferOwnership ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    leave: activeMembers?.leave ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeMembers])
  const tripJourney = useMemo<TripJourneyApi>(() => ({
    listDestinations: activeJourney?.listDestinations ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    createDestination: activeJourney?.createDestination ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    deleteDestination: activeJourney?.deleteDestination ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    listTransports: activeJourney?.listTransports ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    createTransport: activeJourney?.createTransport ?? (async () => ({ ok: false, error: { kind: 'server' } })),
    updateTransport: activeJourney?.updateTransport ?? (async () => ({ ok: false, error: { kind: 'server' } })),
  }), [activeJourney])

  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const sessionStatus: SessionStatus = !sessionReady ? 'restoring' : hasSession ? 'active' : 'none'
  const sessionStatusRef = useRef(sessionStatus)
  sessionStatusRef.current = sessionStatus

  // The opener listens as early as possible (before the session is restored) and queues what arrives until there is one.
  // Inert on the web and in jsdom: it needs a native platform or an injected port.
  useEffect(() => {
    const port = noticePort ?? (Capacitor.isNativePlatform() ? createCapacitorCapabilities().push : undefined)
    if (!port) return
    const created = createNotificationOpener({
      port,
      navigate: (path, options) => navigateRef.current(path, options),
      onOpen: () => { deepLinkReceived.current = true },
      onForeground: () => { setNoticeSignal((value) => value + 1); setNoticeAnnounced(true) },
    })
    created.setSession(sessionStatusRef.current)
    opener.current = created
    void created.start()
    return () => { if (opener.current === created) opener.current = undefined; void created.stop() }
  }, [noticePort])
  useEffect(() => { opener.current?.setSession(sessionStatus) }, [sessionStatus])
  useEffect(() => { if (location.pathname === '/notifications') setNoticeAnnounced(false) }, [location.pathname])

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
        void pushRef.current?.resume()
        return
      }

      if (result?.error.kind === 'unauthorized') {
        // A rejected refresh at cold start drops the pending action: the client does not know the notice's account.
        opener.current?.discard()
        await queueStorageOperation(() => storage.clear())
        return
      }

      session.current = persistedSession
      setHasSession(true)
      void pushRef.current?.resume()
    }

    void restoreSession().catch(() => undefined).finally(() => setSessionReady(true))
  }, [activeAuth, hasApiConfiguration, navigate, queueStorageOperation, storage])

  useEffect(() => {
    if (sessionReady && launchChecked && hasSession && !deepLinkReceived.current &&
      (location.pathname === '/' || location.pathname === '/login')) {
      navigate(invitationDestination(location.state) ?? '/trips', { replace: true })
    }
  }, [hasSession, launchChecked, location.pathname, location.state, navigate, sessionReady])

  // Never throws; the push service bounds the wait, so closing or switching a session never depends on it.
  const revokePush = async () => {
    const accessToken = session.current?.accessToken
    try { await pushRef.current?.revokeBeforeLogout(accessToken === undefined ? undefined : { accessToken }) } catch { /* best effort */ }
  }

  const onAuthenticated = async (authenticatedSession: AuthenticatedSession) => {
    sessionRevision.current += 1
    resetRememberedFilter()
    // With a previous session (possibly another account) a notice waiting for a session is not retaken.
    if (session.current !== undefined) opener.current?.discard()
    setNoticeAnnounced(false)
    // With a previous session, revoke its device registration while its bearer is still the active one.
    if (session.current !== undefined) await revokePush()
    await queueStorageOperation(() => storage.save(authenticatedSession))
    session.current = authenticatedSession
    setSessionExpired(false)
    setHasSession(true)
    setSessionReady(true)
    void pushRef.current?.resume()
    navigate(invitationDestination(latestLocation.current.state) ?? '/trips', { replace: true })
  }

  const onLocalLogout = async () => {
    sessionRevision.current += 1
    opener.current?.discard()
    setNoticeAnnounced(false)
    // The device token is revoked with the outgoing bearer before the session is dropped.
    await revokePush()
    session.current = undefined
    resetRememberedFilter()
    setSessionExpired(false)
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
      {hasSession && noticeAnnounced && location.pathname !== '/notifications'
        ? <Feedback variant="info">Tenés un aviso nuevo. <Link to="/notifications">Ver avisos</Link> <Button onClick={() => setNoticeAnnounced(false)}>Descartar</Button></Feedback>
        : null}
      <ExternalLinkContext.Provider value={linkPort}>
      <Routes>
        <Route path="/" element={<PublicHome />} />
        <Route path="/login" element={<AuthScreen auth={activeAuth} mode="login" onAuthenticated={onAuthenticated} sessionExpired={sessionExpired} />} />
        <Route path="/register" element={<AuthScreen auth={activeAuth} mode="register" />} />
        <Route path="/invite/:code" element={<InviteRoute sessionReady={sessionReady} hasSession={hasSession} trips={activeTrips} push={activePush} />} />
        <Route path="/trips" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <TripsListScreen trips={tripManagement} onLocalLogout={onLocalLogout} />
          </TripRoute>
        } />
        <Route path="/trips/new" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <CreateTripScreen trips={tripManagement} />
          </TripRoute>
        } />
        <Route path="/trips/join" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <TripJoinScreen />
          </TripRoute>
        } />
        <Route path="/trips/explore" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <TripExploreScreen trips={tripManagement} />
          </TripRoute>
        } />
        <Route path="/trips/explore/:tripId" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <PublicTripConfirmationScreen trips={tripManagement} />
          </TripRoute>
        } />
        <Route path="/trips/:tripId/config" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <TripConfigurationScreen trips={tripManagement} />
          </TripRoute>
        } />
        <Route path="/trips/:tripId/journey" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <TripJourneyScreen trips={tripManagement} journey={tripJourney} itinerary={tripItinerary} />
          </TripRoute>
        } />
        <Route element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <TripContentLayout gallery={galleryProvider} trips={tripManagement} lifecycle={lifecycle ?? appLifecycle} />
          </TripRoute>
        }>
        <Route path="/trips/:tripId/members" element={<TripMembersScreen trips={tripManagement} members={tripMembers} apiBaseUrl={apiBaseUrl} />} />
        <Route path="/trips/:tripId/itinerary" element={
          <TripItineraryScreen itinerary={tripItinerary} activities={tripActivities} participations={tripParticipations} members={tripMembers} trips={tripManagement} calendarSync={activeCalendarSync} />
        } />
        <Route path="/trips/:tripId/balance" element={<TripBalanceScreen balance={tripBalance} posts={tripPosts} members={tripMembers} />} />
        <Route path="/trips/:tripId/memories" element={<MemoriesLayout />}>
          <Route index element={<TripMemoriesScreen posts={tripPosts} members={tripMembers} />} />
          <Route path="new" element={<PostComposer posts={tripPosts} itinerary={tripItinerary} photos={photoDeps} members={tripMembers} />} />
          <Route path="photos" element={<TripPhotosScreen members={tripMembers} />} />
          <Route path=":postId" element={<PostDetailScreen posts={tripPosts} members={tripMembers} comments={tripComments} likes={tripLikes} />} />
          <Route path=":postId/edit" element={<PostComposer posts={tripPosts} itinerary={tripItinerary} photos={photoDeps} members={tripMembers} />} />
          <Route path="new/link" element={<PostLinkPicker posts={tripPosts} itinerary={tripItinerary} spontaneousActivity />} />
          <Route path="new/activity" element={<SpontaneousActivityForm itinerary={tripItinerary} />} />
          <Route path=":postId/edit/link" element={<PostLinkPicker posts={tripPosts} itinerary={tripItinerary} spontaneousActivity />} />
          <Route path=":postId/edit/activity" element={<SpontaneousActivityForm itinerary={tripItinerary} />} />
          <Route path="new/expense" element={<ExpenseForm itinerary={tripItinerary} />} />
          <Route path=":postId/edit/expense" element={<ExpenseForm itinerary={tripItinerary} />} />
          <Route path="new/expense/split" element={<ExpenseSplitForm posts={tripPosts} members={tripMembers} />} />
          <Route path=":postId/edit/expense/split" element={<ExpenseSplitForm posts={tripPosts} members={tripMembers} />} />
        </Route>
        </Route>
        <Route path="/notifications" element={
          <TripRoute sessionReady={sessionReady} hasSession={hasSession}>
            <NotificationsScreen notifications={tripNotifications} refreshSignal={noticeSignal} />
          </TripRoute>
        } />
        <Route path="/profile" element={
          !sessionReady
            ? <main className="app-shell"><LoadingState label="Restaurando sesión…" /></main>
            : hasSession
              ? <ProfileScreen auth={activeAuth} push={activePush} />
              : <Navigate to="/login" replace />
        } />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </ExternalLinkContext.Provider>
    </>
  )
}

type InviteEntryProps = { sessionReady: boolean; hasSession: boolean; trips?: Partial<TripInvitationApi>; push?: PushDeviceService }

function InviteRoute(props: InviteEntryProps) {
  const { code } = useParams()
  return <InviteEntry key={code} code={code} {...props} />
}

function InviteEntry({ sessionReady, hasSession, trips, push, code }: InviteEntryProps & { code?: string }) {
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
    <main className="app-shell trips-shell">
      <section className="status-panel invite-panel">
        <p className="eyebrow">Invitación</p>
        <h1>Unirse a un viaje</h1>
        <p>Tu código de invitación: <strong>{code}</strong></p>
        {!sessionReady
          ? <LoadingState label="Restaurando sesión…" />
          : !hasSession
            ? <p>Iniciá sesión para continuar. <Link to="/login" state={{ from: destination }}>Iniciar sesión</Link></p>
            : result?.ok
              ? <><p>{result.value.joined ? 'Te uniste al viaje.' : 'Ya sos parte de este viaje.'}</p><Link to={`/trips/${result.value.tripId}/members`}>Ver miembros</Link>{result.value.joined && push ? <PushNotices push={push} dismissible /> : null}</>
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
    <main className="app-shell access-shell">
      <section className="welcome-panel" aria-labelledby="welcome-title">
        <div className="welcome-brand">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7V4h10v3M4 7h16v14H4zM9 7v14M15 7v14" /></svg>
          <h1 id="welcome-title">Travellier</h1>
          <p className="welcome-tagline">El viaje empieza con ustedes.</p>
          <p>Organicen los planes. Guarden los momentos.</p>
        </div>
        <h2 className="welcome-title">Todo el viaje, en un solo lugar.</h2>
        <p className="welcome-help">Itinerario, fotos y recuerdos compartidos con tu grupo.</p>
        <div className="welcome-actions">
          <Link className="ui-button" to="/register">Crear cuenta</Link>
          <Link className="ui-button ui-button--secondary" to="/login">Ya tengo cuenta</Link>
        </div>
      </section>
    </main>
  )
}

function TripRoute({ sessionReady, hasSession, children }: { sessionReady: boolean; hasSession: boolean; children: ReactNode }) {
  if (!sessionReady) return <main className="app-shell"><LoadingState label="Restaurando sesión…" /></main>
  return hasSession ? children : <Navigate to="/login" replace />
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
