import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// Published TestFlight/App Store builds only. A failed check is silent and never holds up launch.
@MainActor @Observable final class UpdateChecker {
  private(set) var available: APIClient.IOSVersion?
  private var lastAttempt = Date.distantPast
  private var checking = false
  private var dismissedBuild: Int?

  var visible: APIClient.IOSVersion? {
    guard let available, available.build != dismissedBuild else { return nil }
    return available
  }

  func dismiss() { dismissedBuild = available?.build }

  func check(server: URL) async {
    guard !checking, Date().timeIntervalSince(lastAttempt) >= 60 else { return }
    lastAttempt = Date()
    checking = true
    defer { checking = false }
    guard let release = try? await APIClient(server: server).iosVersion(),
          release.version != nil, let build = release.build,
          let installed = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"),
          build > installed, let url = release.url.flatMap(URL.init(string:)), url.scheme == "https" else { return }
    available = release
  }
}

@main
struct SeeSubtitlesApp: App {
  @Environment(\.scenePhase) private var scenePhase
  @State private var app = AppModel()
  @State private var updates = UpdateChecker()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(app)
        .environment(updates)
        .environment(app.prefs)
        .preferredColorScheme(app.prefs.colorScheme)
        .tint(Color.mqAccentText)
        .task {
          Task { await updates.check(server: app.server) }
          await app.launch()
        }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { Task { await updates.check(server: app.server) } }
        }
        // a talk's share link — scanned with the Camera, tapped in a message — opens the reader
        .onOpenURL { url in if let code = APIClient.shareCode(from: url.absoluteString) { app.joinCode = code } }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
          if let url = activity.webpageURL, let code = APIClient.shareCode(from: url.absoluteString) { app.joinCode = code }
        }
    }
  }
}
