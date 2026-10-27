# iOS client

This Swift package pins MapLibre Native iOS 6.28.0 and contains the stable
cross-platform contracts, API client, tests, and SwiftUI `UIViewRepresentable`
map. The map keeps pitch at or below 60° and retains MapLibre attribution.

Run contract tests on macOS with `swift test`. Open the package in Xcode with an
iOS destination to compile the MapLibre-backed UI target. Applying production
feature-state values follows when the preview geometry becomes a real MVT
endpoint.
