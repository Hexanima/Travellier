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
