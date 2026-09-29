// swift-tools-version: 6.2
// HumCore: the player's pure logic (profile, model, filter, queue, search), a
// port of packages/core. Foundation only, so it builds and tests on Linux too.
import PackageDescription

let package = Package(
  name: "HumCore",
  platforms: [.iOS(.v26), .macOS(.v15)],
  products: [.library(name: "HumCore", targets: ["HumCore"])],
  targets: [
    .target(name: "HumCore"),
    .testTarget(name: "HumCoreTests", dependencies: ["HumCore"]),
  ]
)
