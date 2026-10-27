import CloseKnitCore
import SwiftUI

#if os(iOS)
import MapLibre
import UIKit

public struct MapLibreAreaMap: UIViewRepresentable {
    private let state: MapState
    private let styleURL: URL

    public init(
        state: MapState,
        styleURL: URL = URL(string: "https://tiles.openfreemap.org/styles/positron")!
    ) {
        self.state = state
        self.styleURL = styleURL
    }

    public func makeUIView(context: Context) -> MLNMapView {
        let view = MLNMapView(frame: .zero, styleURL: styleURL)
        view.maximumPitch = 60
        view.logoView.isHidden = false
        view.attributionButton.isHidden = false
        update(view, animated: false)
        return view
    }

    public func updateUIView(_ view: MLNMapView, context: Context) {
        update(view, animated: true)
    }

    private func update(_ view: MLNMapView, animated: Bool) {
        let center = CLLocationCoordinate2D(latitude: state.latitude, longitude: state.longitude)
        view.setCenter(center, zoomLevel: state.zoom, direction: state.bearing, animated: animated)
        view.camera = MLNMapCamera(
            lookingAtCenter: center,
            altitude: view.camera.altitude,
            pitch: state.pitch,
            heading: state.bearing
        )
    }
}
#else
public struct MapLibreAreaMap: View {
    public init(
        state _: MapState,
        styleURL _: URL = URL(string: "https://tiles.openfreemap.org/styles/positron")!
    ) {}

    public var body: some View { Text("MapLibreAreaMap is available on iOS") }
}
#endif
