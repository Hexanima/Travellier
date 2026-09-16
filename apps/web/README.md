# Travellier mobile client

React/Vite client packaged with Capacitor for Android and iOS.

The client owns React routing and the native Capacitor adapters. It imports the domain package through `app-domain`; native concerns do not reach `domain`.

The custom URL scheme is registered in T18. The shell is already prepared to resolve `com.tuapp://...` URLs delivered by the Capacitor App plugin.

## Commands

- `yarn workspace web dev`
- `yarn workspace web test --run`
- `yarn workspace web build`
- `yarn workspace web cap:sync`
- `yarn workspace web cap:build:android`
- `yarn workspace web cap:build:ios`

Android builds require Android Studio and its SDK. From the command line, point `JAVA_HOME` to Android Studio's bundled JBR and `ANDROID_HOME` to the installed SDK. iOS builds require macOS with Xcode.
