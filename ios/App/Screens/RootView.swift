import SubtitlesDesign
import SwiftUI
import UIKit

/// The account is the door. Logged out, the app is the login card and nothing else — except a talk someone
/// else is giving, which needs no account to follow, and the demo.
struct RootView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  @Environment(UpdateChecker.self) private var updates

  var body: some View {
    @Bindable var app = app
    Group {
      if !app.canUseApp { LoginView() }
      else if !prefs.firstRunDone { FirstRunView() }
      else { MainTabs() }
    }
    .background(Color.mqBackground.ignoresSafeArea())
    .safeAreaInset(edge: .top, spacing: 0) {
      if let release = updates.visible, let build = release.build {
        HStack(spacing: Spacing.s3) {
          VStack(alignment: .leading, spacing: 2) {
            Text(L("ios.update.available", ["build": String(build)])).font(.mqSecondary.weight(.semibold))
            Text(release.channel == "appstore" ? L("ios.update.appStoreHint") : L("ios.update.testFlightHint")).font(.mqHint)
          }
          Spacer(minLength: 4)
          Button(release.channel == "appstore" ? L("ios.update.openStore") : L("ios.update.openTestFlight")) {
            if let url = release.url.flatMap(URL.init(string:)) { UIApplication.shared.open(url) }
          }
          Button { updates.dismiss() } label: { Image(systemName: "xmark").accessibilityLabel(L("ios.update.later")) }
        }
        .foregroundStyle(Color.mqText)
        .padding(.horizontal, Spacing.s3).padding(.vertical, Spacing.s2)
        .background(Color.mqSurface)
      }
    }
    .fullScreenCover(item: Binding(get: { app.joinCode.map(JoinTarget.init) }, set: { app.joinCode = $0?.code })) { target in
      JoinedTalkView(code: target.code)
    }
    // the language is an app setting, so the whole tree is rebuilt in the new one
    .id(prefs.language)
  }
}

struct JoinTarget: Identifiable { let code: String; var id: String { code } }

struct MainTabs: View {
  @State private var tab = 0
  var body: some View {
    TabView(selection: $tab) {
      LiveView(showLibrary: { tab = 1 }).tabItem { Label(L("ios.tab.live"), systemImage: "mic") }.tag(0)
      LibraryView(startTalk: { tab = 0 }).tabItem { Label(L("ios.tab.library"), systemImage: "list.bullet") }.tag(1)
      SettingsView().tabItem { Label(L("ios.tab.settings"), systemImage: "gearshape") }.tag(2)
    }
  }
}
