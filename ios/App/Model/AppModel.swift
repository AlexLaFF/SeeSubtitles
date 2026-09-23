import AVFoundation
import SubtitlesCore
import SwiftUI

/// The app's one model: who is signed in, what they have chosen, what is on the phone, and the talk that is running.
@MainActor @Observable
final class AppModel {
  let prefs: Preferences
  let server: URL
  let library = RecordingLibrary.standard()

  private(set) var token: String?
  private(set) var account: Account?
  private(set) var glossary = Glossary(items: [], updatedAt: nil)
  private(set) var recordings: [Recording] = []
  private(set) var recovered: [String] = []
  var live: LiveModel?
  /// A share code waiting to be followed: from a scanned link, or typed.
  var joinCode: String?

  init() {
    // UI tests begin from a phone nobody has used: -ResetForTests YES forgets the login, the settings and the
    // recordings before anything reads them. (A simulator's keychain outlives the app being deleted.)
    if UserDefaults.standard.bool(forKey: "ResetForTests") {
      Keychain.write(nil, for: "token")
      try? FileManager.default.removeItem(at: RecordingLibrary.standard().root)
      if let domain = Bundle.main.bundleIdentifier { UserDefaults.standard.removePersistentDomain(forName: domain) }
    }
    prefs = Preferences() // after the reset above, so a test's clean slate is what it reads
    // Tests and development point the app at another server: -SubtitlesServer http://127.0.0.1:8080
    server = UserDefaults.standard.string(forKey: "SubtitlesServer").flatMap(URL.init(string:)) ?? APIClient.production
    token = Keychain.read("token")
  }

  /// The account is the door: without one, the app is the login card — or the demo, which needs none.
  var isSignedIn: Bool { token != nil }
  var canUseApp: Bool { isSignedIn || prefs.demo }
  var api: APIClient { APIClient(server: server, token: token) }
  var plan: Plan? { account?.plan }

  // ---------------------------------------------------------------- the account

  func login(email: String, password: String, code: String?) async throws {
    let device = "\(UIDevice.current.model) · See Subtitles"
    let result = try await APIClient(server: server).login(email: email, password: password, code: code, device: device)
    token = result.token
    Keychain.write(result.token, for: "token")
    prefs.demo = false
    await refreshAccount()
  }

  func loginApple(code: String, nonce: String) async throws {
    let result = try await APIClient(server: server).loginApple(code: code, nonce: nonce)
    token = result.token
    Keychain.write(result.token, for: "token")
    prefs.demo = false
    await refreshAccount()
  }

  func logout() async {
    await live?.stop()
    try? await api.logout()
    signedOut()
  }

  /// The server no longer knows this token: signed out from another device, or the password was changed.
  private func signedOut() {
    token = nil
    account = nil
    Keychain.write(nil, for: "token")
  }

  func refreshAccount() async {
    guard isSignedIn else { return }
    do {
      account = try await api.me()
      glossary = (try? await api.glossary()) ?? glossary
    } catch let error as APIError where error.status == 401 {
      signedOut()
    } catch {
      // offline: what was known stays known
    }
  }

  func save(glossary items: [GlossaryItem]) async throws { glossary = try await api.saveGlossary(items) }

  // ---------------------------------------------------------------- the library

  func launch() async {
    recovered = await library.recoverInterrupted() // before anything can be recording
    refreshLibrary()
    await refreshAccount()
  }

  func refreshLibrary() { recordings = library.all() }

  // ---------------------------------------------------------------- a talk

  enum StartProblem: Error { case microphoneDenied, alreadyRunning }

  func microphoneAllowed() async -> Bool {
    switch AVAudioApplication.shared.recordPermission {
    case .granted: return true
    case .denied: return false
    default: return await AVAudioApplication.requestRecordPermission()
    }
  }

  func startTalk() async throws {
    guard live == nil || live?.isOver == true else { throw StartProblem.alreadyRunning }
    guard await microphoneAllowed() else { throw StartProblem.microphoneDenied }
    let options = prefs.relayOptions(hotwords: glossary.hotwords)
    let relay = RelayClient(server: server, token: token ?? "", options: options, opener: prefs.demo ? DemoRelayOpener() : URLSessionRelayOpener())
    // UI tests speak through a file: -SubtitlesAudioFile /path/to/recording.m4a
    let source: any AudioSource = UserDefaults.standard.string(forKey: "SubtitlesAudioFile").map { FileAudioSource(url: URL(fileURLWithPath: $0)) } ?? MicrophoneCapture()
    let session = TalkSession(source: source, relay: relay, recorder: Recorder(root: library.root), options: options, recordAudio: prefs.recordOnStart)
    let model = LiveModel(session: session, recording: prefs.recordOnStart, app: self)
    live = model
    try await model.start()
  }
}
