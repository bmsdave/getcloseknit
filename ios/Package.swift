// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "CloseKnitIOS",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CloseKnitCore", targets: ["CloseKnitCore"]),
        .library(name: "CloseKnitUI", targets: ["CloseKnitUI"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/maplibre/maplibre-gl-native-distribution",
            exact: "6.28.0"
        ),
    ],
    targets: [
        .target(name: "CloseKnitCore"),
        .target(
            name: "CloseKnitUI",
            dependencies: [
                "CloseKnitCore",
                .product(
                    name: "MapLibre",
                    package: "maplibre-gl-native-distribution",
                    condition: .when(platforms: [.iOS])
                ),
            ]
        ),
        .testTarget(name: "CloseKnitCoreTests", dependencies: ["CloseKnitCore"]),
    ]
)
