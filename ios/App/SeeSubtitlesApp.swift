import SubtitlesCore
import SubtitlesDesign
import SwiftUI

@main
struct SeeSubtitlesApp: App {
  @State private var app = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(app)
        .environment(app.prefs)
        .preferredColorScheme(app.prefs.colorScheme)
        .tint(Color.mqAccentText)
        .task { await app.launch() }
        // a talk's share link — scanned with the Camera, tapped in a message — opens the reader
        .onOpenURL { url in if let code = APIClient.shareCode(from: url.absoluteString) { app.joinCode = code } }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
          if let url = activity.webpageURL, let code = APIClient.shareCode(from: url.absoluteString) { app.joinCode = code }
        }
    }
  }
}
