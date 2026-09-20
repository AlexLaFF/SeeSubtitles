import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// Someone else's talk, followed through its share code: the same reader, without a microphone. When the host
/// ends it — or the reader leaves — the words are kept in the Library as a joined talk.
@MainActor @Observable
final class JoinedModel {
  let code: String
  private(set) var name = ""
  private(set) var transcript = Transcript()
  private(set) var state: State = .connecting
  var unseen = 0
  /// The host's languages, once known: a joined talk is kept under them, and they choose the voice.
  private(set) var source: String?
  private(set) var target: String?
  /// The translation, spoken. A joined talk has no microphone, so any output will do — though headphones are kinder.
  var spoken: SpokenTranslation?
  private var task: Task<Void, Never>?
  private var saved = false
  private let startedAt = Date()
  enum State: Equatable { case connecting, live, ended, notFound, offline }

  init(code: String) { self.code = code }

  func follow(api: APIClient, haptics: Bool) {
    guard task == nil else { return }
    task = Task {
      do {
        for try await event in api.join(code: code) {
          switch event {
          case .started(let name, let lines, let live, let source, let target):
            self.name = name
            if let source, let target { self.source = source; self.target = target; spoken?.setLanguages(source: source, target: target) }
            for line in lines { transcript.apply(line.asResult, now: Date().timeIntervalSince1970 * 1000) }
            state = live ? .live : .ended
          case .line(let line):
            let (applied, isNew) = transcript.apply(line.asResult, now: Date().timeIntervalSince1970 * 1000)
            if applied.ended, isNew || line.ended == true { unseen += 1; if haptics { Haptics.sentence() } }
            spoken?.offer(applied)
          case .cleared: break // the host cleared their screen; a reader keeps what was said
          case .status(let live, _): if !live, state == .live { state = .ended; if haptics { Haptics.done() } }
          }
          if state == .ended { break }
        }
        if state == .connecting || state == .live { state = .ended }
        spoken?.turnOff()
      } catch let error as APIError where error.status == 404 { state = .notFound }
      catch is CancellationError {} catch { if state != .ended { state = .offline } }
    }
  }

  /// Keep the words. Returns the recording's id, or nil when there was nothing to keep.
  @discardableResult
  func save(to library: RecordingLibrary, source: String, target: String) async -> String? {
    task?.cancel()
    spoken?.turnOff()
    guard !saved, !transcript.finished.isEmpty else { return nil }
    saved = true
    let recorder = Recorder(root: library.root, now: { [startedAt] in startedAt.timeIntervalSince1970 * 1000 })
    guard let id = try? await recorder.start(source: self.source ?? source, target: self.target ?? target, audio: false, kind: .joined, title: name.isEmpty ? nil : name, sessionCode: code) else { return nil }
    for line in transcript.finished { await recorder.add(line) }
    _ = await recorder.stop(transcript: transcript)
    return id
  }
}

struct JoinedTalkView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  @Environment(\.dismiss) private var dismiss
  let code: String
  @State private var model: JoinedModel?
  @State private var textSheet = false
  @State private var reply = false
  @State private var listening = false
  @State private var shownReply: String?

  var body: some View {
    VStack(spacing: 0) {
      if let model {
        HStack {
          StackRow(model.name.isEmpty ? L("ios.join.talk") : model.name, L("ios.join.code", ["code": code]))
          switch model.state {
          case .connecting: StatusLabel(.neutral, L("ios.status.connecting"))
          case .live: StatusLabel(.ok, L("ios.status.live"))
          case .ended: StatusLabel(.neutral, L("ios.status.ended"))
          case .notFound, .offline: StatusLabel(.bad, L("ios.status.notStarted"))
          }
        }.padding(.horizontal, 18).padding(.vertical, 10)

        if model.state == .notFound || model.state == .offline {
          message(model.state == .notFound ? L("ios.join.notFound") : L("ios.err.offline"), sub: nil)
        } else if model.state == .ended, model.transcript.lines.isEmpty {
          message(L("ios.join.endedTitle"), sub: L("ios.join.endedEmpty"))
        } else {
          @Bindable var model = model
          ReaderView(lines: model.transcript.lines, unseen: $model.unseen, speaking: model.state == .live) {
            if model.state == .ended { Card { Text(L("ios.join.endedTitle")).font(.headline); Text(L("ios.join.endedBody")).font(.mqHint).foregroundStyle(Color.mqText3) }.foregroundStyle(Color.mqText) }
          }
        }
        if let spoken = model.spoken { ListenStrip(spoken: spoken) }
        HStack(spacing: 12) {
          Button(model.state == .ended ? L("ios.done") : L("ios.join.leave")) { leave() }.buttonStyle(SecondaryButtonStyle())
          if model.spoken?.hasSomethingToSay == true, model.state == .live {
            Button { listening = true } label: { Image(systemName: "headphones").foregroundStyle(model.spoken?.isOn == true ? Color.mqAccentText : Color.mqText) }
              .buttonStyle(SquareButtonStyle()).accessibilityLabel(L("ios.listen.title")).accessibilityIdentifier("listen")
          }
          Button { reply = true } label: { Image(systemName: "bubble.left") }.buttonStyle(SquareButtonStyle()).accessibilityLabel(L("ios.reply.title"))
          Button { textSheet = true } label: { Image(systemName: "textformat.size") }.buttonStyle(SquareButtonStyle()).accessibilityLabel(L("ios.text.title"))
        }
        .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 8)
        .overlay(alignment: .top) { Rectangle().fill(Color.mqLine).frame(height: 1) }
      }
    }
    .background((prefs.highContrast ? Color.black : Color.mqBackground).ignoresSafeArea())
    .task {
      guard model == nil else { return }
      let m = JoinedModel(code: code)
      m.spoken = SpokenTranslation(prefs: prefs, source: prefs.source, target: prefs.target, headphonesOnly: false)
      model = m
      UIApplication.shared.isIdleTimerDisabled = prefs.keepAwake
      m.follow(api: app.api, haptics: prefs.haptics)
    }
    .sheet(isPresented: $textSheet) { TextSheet().presentationDetents([.medium]) }
    .sheet(isPresented: $reply) { ReplySheet { shownReply = $0 }.presentationDetents([.medium, .large]) }
    .sheet(isPresented: $listening) {
      if let model, let spoken = model.spoken {
        ListenSheet(spoken: spoken, headphonesOnly: false) { on in
          prefs.listen = on
          if on { spoken.turnOn(existing: model.transcript.lines.map(\.id)) } else { spoken.turnOff() }
        }.presentationDetents([.medium, .large])
      }
    }
    .fullScreenCover(item: Binding(get: { shownReply.map(ShownReply.init) }, set: { shownReply = $0?.text })) { ShownReplyView(text: $0.text) }
  }

  private func message(_ title: String, sub: String?) -> some View {
    VStack(spacing: 12) { MarkView(size: 48); Text(title).font(.title2.weight(.semibold)).multilineTextAlignment(.center); if let sub { Text(sub).font(.mqSecondary).foregroundStyle(Color.mqText2).multilineTextAlignment(.center) } }
      .foregroundStyle(Color.mqText).padding(.horizontal, 36).frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private func leave() {
    UIApplication.shared.isIdleTimerDisabled = false
    Task {
      await model?.save(to: app.library, source: prefs.source, target: prefs.target)
      app.refreshLibrary()
      dismiss()
    }
  }
}
