# Android client

The Compose client pins MapLibre Native Android 13.4.1 and consumes the same
metric IDs, geography IDs, API base path, style URL, 45° default pitch, and 60°
maximum pitch as web and iOS.

Run unit tests with a Gradle 8.9 wrapper and Java 17:

```sh
./gradlew testDebugUnitTest
```

The current screen proves the native MapLibre camera and platform-native layer
controls. Applying production feature-state values follows when the preview
geometry becomes a real MVT endpoint.
