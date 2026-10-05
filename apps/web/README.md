# Travellier mobile client

React/Vite client packaged with Capacitor for Android and iOS.

The client owns React routing and the native Capacitor adapters. It imports the domain package through `app-domain`; native concerns do not reach `domain`.

The native projects register `com.travellier.app://`. The shell resolves URLs delivered by the Capacitor App plugin; T18 will add the invitation and verification flows.

## API endpoint for mobile builds

Before generating a Capacitor build, copy `.env.example` to `.env.production.local` and set `VITE_API_BASE_URL` to the deployed API Gateway HTTP(S) URL. Vite embeds this value in the native web bundle; without a valid URL, the app blocks the authentication entry points instead of sending relative requests to the WebView origin.

## Commands

- `yarn workspace web dev`
- `yarn workspace web test --run`
- `yarn workspace web build`
- `yarn workspace web cap:sync`
- `yarn workspace web cap:build:android`
- `yarn workspace web cap:build:ios`

Android builds require Android Studio and its SDK. From the command line, point `JAVA_HOME` to Android Studio's bundled JBR and `ANDROID_HOME` to the installed SDK. iOS builds require macOS with Xcode.

## Activity participation (T39)

The itinerary and activity detail share the current user's participation controls: “Voy” (`going`), “No voy” (`not_going`) and “Sin responder” (`pending`). The authenticated GET/PUT `/trips/:tripId/activities/:activityId/participation` endpoints from T38 must be available in the deployed API.

An absent record appears as unanswered only after a successful GET; loading and read failures have separate states. Responses are loaded once per activity during the screen's lifetime. A successful PUT updates only the own participation shared by agenda and detail, without fetching the itinerary again or changing the activity's voting status, other members' responses, posts or expenses. Failed writes preserve the previous selection and allow retry; unavailable resources and expired sessions disable the participation controls. Leaving the itinerary or changing Trip clears the screen's participation state.
