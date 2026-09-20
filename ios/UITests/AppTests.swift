import AVFoundation
import XCTest

// The app itself, driven in the Simulator the way a person would drive it. Two journeys:
//
//   testDemoJourney      no account, no network: first run, a talk, Text, Listen, Reply, the ended card, the recording's
//                        three tabs, a summary, an MP4, rename, delete, Settings, and the interface in Chinese.
//   testSignedInJourney  against the real server the harness starts (ios/e2e/run.mjs sets E2E_SERVER): a wrong password,
//                        login, a talk with a recording as the microphone and subtitles from the relay, the account and
//                        its devices, joining a talk a Mac is hosting, logging out. Skipped without the harness.
//
// Every launch begins from a phone nobody has used (-ResetForTests), speaks without a sound (-SilentVoice: a simulator
// talks through the Mac's loudspeakers) and is in English unless the test is about Chinese. The words looked for are the
// catalogue's English (web/locales.js); a string changed there is changed here.
@MainActor
final class AppTests: XCTestCase {
  let app = XCUIApplication()
  let common = ["-ResetForTests", "YES", "-language", "en", "-SilentVoice", "YES", "-SpeakWithoutHeadphones", "YES"]
  var env: [String: String] { ProcessInfo.processInfo.environment }

  override func setUp() async throws { continueAfterFailure = false }

  // ---------------------------------------------------------------- looking, and waiting

  /// Any element whose label contains `text`.
  func element(containing text: String) -> XCUIElement { app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch }
  func seen(_ text: String, within seconds: Double = 15, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(element(containing: text).waitForExistence(timeout: seconds), "never saw “\(text)”", file: file, line: line)
  }
  func gone(_ text: String, within seconds: Double = 10, file: StaticString = #filePath, line: UInt = #line) {
    let e = element(containing: text)
    let done = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: e)
    XCTAssertEqual(XCTWaiter().wait(for: [done], timeout: seconds), .completed, "“\(text)” is still there", file: file, line: line)
  }
  func tap(_ label: String, file: StaticString = #filePath, line: UInt = #line) {
    // by its name, or by how its name begins: a button with a hint under its title is read as "title, hint"
    let exact = app.buttons[label].firstMatch
    let button = exact.waitForExistence(timeout: 3) ? exact : app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", label)).firstMatch
    XCTAssertTrue(button.waitForExistence(timeout: 10), "no button “\(label)”", file: file, line: line)
    button.tap()
  }
  func tab(_ name: String) { app.tabBars.buttons[name].firstMatch.tap() }
  /// A SwiftUI toggle is a row with a switch at its far end; a tap in the middle of the row lands on its words.
  func flip(_ toggle: XCUIElement) {
    XCTAssertTrue(toggle.waitForExistence(timeout: 10))
    toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
  }
  /// After a login iOS offers to keep the password, in a dialog of its own that sits over the app and swallows taps.
  func declineToSavePassword() {
    let system = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    for candidate in [app.buttons["Not Now"].firstMatch, system.buttons["Not Now"].firstMatch] where candidate.waitForExistence(timeout: 4) { candidate.tap(); return }
  }
  func dismissSheet() { app.swipeDown(velocity: .fast); if app.buttons["Done"].exists { app.buttons["Done"].tap() } }

  // ---------------------------------------------------------------- without an account

  func testDemoJourney() throws {
    app.launchArguments = common
    app.launch()

    // logged out, the app is the login card and nothing else
    seen("Accounts are opened at seesubtitles.com.")
    XCTAssertFalse(app.tabBars.firstMatch.exists, "a logged-out app must show only the login card")
    tap("Try the demo")

    // first run: why the microphone, then the two languages
    seen("The microphone is how subtitles begin")
    tap("Allow the microphone")
    seen("Two languages")
    seen("Spoken in the room")
    tap("Done")

    // Live, idle
    seen("Ready when the room is.")
    seen("ready")
    seen("Recording is on")

    // a talk
    app.buttons["start"].tap()
    seen("大家好，欢迎来到今天的分享。", within: 20)
    seen("recording")
    XCTAssertTrue(element(containing: "大家好，欢迎嚟到今日嘅分享。").exists, "the original sits under the translation")

    // Text: the original alone, then both again
    tap("Text")
    tap("Original")
    dismissSheet()
    gone("大家好，欢迎来到今天的分享。")
    tap("Text"); tap("Both"); dismissSheet()
    seen("大家好，欢迎来到今天的分享。")

    // Listen: the translation spoken (silently, here), counted as each sentence is finished
    app.buttons["listen"].tap()
    seen("Headphones only")
    flip(app.switches["listenToggle"].firstMatch)
    dismissSheet()
    seen("Speaking 普通话 in your headphones")
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label MATCHES %@", ".*[1-9][0-9]* spoken.*")).firstMatch.waitForExistence(timeout: 25), "Listen never finished saying a sentence")

    // Reply: typed, shown large, kept
    tap("Reply")
    let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap(); field.typeText("Could you say that again?")
    tap("Show it large")
    seen("Could you say that again?")
    tap("Back to subtitles")

    // Stop: the ended card, and the recording it opens
    app.buttons["stop"].tap()
    seen("ended")
    seen("sentences")
    tap("Open recording")
    seen("Transcript")
    seen("大家好，欢迎来到今天的分享。")
    seen("Could you say that again?")
    XCTAssertTrue(app.buttons["play"].exists, "a recording with audio has a player")
    app.buttons["play"].tap(); app.buttons["play"].tap()

    // Summary
    tap("Summary")
    tap("Summarise")
    seen("Subtitles serve the whole room", within: 30)
    seen("Summarise again", within: 30)

    // Files: what the talk left, named as the Mac names them; then a video made on the device
    tap("Files")
    seen("录音.m4a"); seen("中文字幕.zh.srt"); seen("粤语字幕.yue.srt"); seen("AI总结.md"); seen("AI总结.pdf")
    app.swipeUp()
    tap("Make MP4")
    app.swipeDown()
    seen("录音＋字幕.mp4", within: 90)

    // Library: the recording, its badges; rename; delete
    app.navigationBars.buttons.firstMatch.tap()
    tab("Library")
    seen("summary"); seen("MP4")
    let row = app.cells.firstMatch
    row.press(forDuration: 1.0)
    tap("Rename")
    let name = app.alerts.textFields.firstMatch
    XCTAssertTrue(name.waitForExistence(timeout: 5))
    name.tap(); name.typeText(" · renamed")
    app.alerts.buttons["Save"].tap()
    seen("· renamed")
    app.cells.firstMatch.swipeLeft()
    tap("Delete")
    app.buttons["Delete"].firstMatch.tap() // and once more, to mean it
    seen("Nothing recorded yet.")

    // Settings, and the whole interface in Simplified Chinese
    tab("Settings")
    seen("Demo mode")
    seen("Recognition")
    app.swipeUp()
    tap("Language,") // the picker, read as "Language, English" — not the "Languages" row above it
    tap("简体中文")
    XCTAssertTrue(app.tabBars.buttons["设置"].waitForExistence(timeout: 10), "the interface did not change language")
    XCTAssertTrue(app.tabBars.buttons["录音库"].exists && app.tabBars.buttons["实时字幕"].exists)
  }

  // ---------------------------------------------------------------- signed in, against the real server

  func testSignedInJourney() async throws {
    guard let server = env["E2E_SERVER"], let control = env["E2E_CONTROL"], let password = env["E2E_PASSWORD"], let email = env["E2E_BUSINESS"] else {
      throw XCTSkip("needs the harness's server: node ios/e2e/run.mjs ui")
    }
    app.launchArguments = common + ["-firstRunDone", "YES", "-SubtitlesServer", server, "-SubtitlesAudioFile", try Self.roomRecording().path]
    app.launch()

    // the door: a wrong password says so, the right one opens it
    let emailField = app.textFields["Email"].firstMatch
    XCTAssertTrue(emailField.waitForExistence(timeout: 15))
    emailField.tap(); emailField.typeText(email)
    let passwordField = app.secureTextFields["Password"].firstMatch
    passwordField.tap(); passwordField.typeText("not the password\n")
    seen("wrong email or password")
    passwordField.tap()
    passwordField.press(forDuration: 1.2); if app.menuItems["Select All"].waitForExistence(timeout: 2) { app.menuItems["Select All"].tap() }
    passwordField.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 24) + password + "\n")
    declineToSavePassword()
    seen("Ready when the room is.", within: 20)
    seen("live hours left") // the plan came with the account

    // a talk through the relay, a recording standing in for the room
    app.buttons["start"].tap()
    seen("大家好，欢迎来到今天的分享。", within: 30) // recognised and translated by the server's stand-ins, through the real relay
    seen("recording")
    app.buttons["stop"].tap()
    tap("Open recording")
    seen("大家好，欢迎来到今天的分享。")
    app.navigationBars.buttons.firstMatch.tap()

    // the account, its hours, its devices
    tab("Settings")
    seen(email); seen("Business")
    seen("Live this month")
    tap("Devices")
    seen("this device")
    app.navigationBars.buttons.firstMatch.tap()

    // someone else's talk: a Mac hosts one, the phone joins by its code
    let hosted = try await Self.ask(control, "host/start", ["name": "字幕与共融 讲座"])
    let code = try XCTUnwrap(hosted["code"] as? String)
    _ = try await Self.ask(control, "host/say", ["code": code])
    tab("Live")
    tap("Join a talk")
    let codeField = app.textFields.firstMatch
    XCTAssertTrue(codeField.waitForExistence(timeout: 10))
    codeField.tap(); codeField.typeText(code)
    tap("Join")
    seen("字幕与共融 讲座", within: 20)
    seen("大家好，欢迎来到今天的分享。")
    let said = try await Self.ask(control, "host/say", ["code": code])
    seen(try XCTUnwrap(said["target"] as? String))
    _ = try await Self.ask(control, "host/end", ["code": code])
    seen("This talk has ended", within: 20)
    tap("Done")
    tab("Library")
    seen("joined"); seen("字幕与共融 讲座")

    // and out again: back to the login card, the recordings still on the phone
    tab("Settings")
    app.swipeUp()
    tap("Log out")
    app.buttons["Log out"].firstMatch.tap()
    seen("Accounts are opened at seesubtitles.com.")
    XCTAssertFalse(app.tabBars.firstMatch.exists)
  }

  // ---------------------------------------------------------------- helpers

  /// Twenty seconds of tone for the app to "hear". The harness's recogniser does not listen, it counts.
  static func roomRecording() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("room-\(UUID().uuidString).wav")
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48_000, channels: 1, interleaved: true)!
    let file = try AVAudioFile(forWriting: url, settings: format.settings, commonFormat: .pcmFormatInt16, interleaved: true)
    let frames = 48_000 * 20
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))!
    buffer.frameLength = AVAudioFrameCount(frames)
    for n in 0..<frames { buffer.int16ChannelData![0][n] = Int16(5000 * sin(2 * Double.pi * 330 * Double(n) / 48_000)) }
    try file.write(from: buffer)
    return url
  }

  /// Ask the harness's control plane for something only the operator's side can do.
  nonisolated static func ask(_ control: String, _ path: String, _ body: [String: String]) async throws -> [String: Any] {
    var request = URLRequest(url: URL(string: control)!.appendingPathComponent(path))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, _) = try await URLSession.shared.data(for: request)
    return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
  }
}
