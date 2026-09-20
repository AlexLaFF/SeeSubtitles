import SubtitlesCore
import SubtitlesDesign
import SwiftUI

struct LiveView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  @Environment(\.verticalSizeClass) private var vertical
  var showLibrary: () -> Void

  @State private var sheet: Sheet?
  @State private var shownReply: String?
  @State private var problem: String?
  @State private var starting = false
  @State private var barHidden = true // in landscape, until the screen is tapped
  @State private var openRecording: Recording?
  enum Sheet: String, Identifiable { case text, reply, languages, join; var id: String { rawValue } }

  private var live: LiveModel? { app.live }
  private var running: Bool { live.map { !$0.isOver } ?? false }
  private var heldUp: Bool { vertical == .compact && running }

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        if !heldUp { header }
        content
        if !heldUp || !barHidden { bar }
      }
      .background((prefs.highContrast && running ? Color.black : Color.mqBackground).ignoresSafeArea())
      .toolbar(heldUp ? .hidden : .visible, for: .tabBar)
      .contentShape(Rectangle())
      .onTapGesture { if heldUp { withAnimation { barHidden.toggle() } } }
      .sheet(item: $sheet) { which in
        switch which {
        case .text: TextSheet().presentationDetents([.medium, .large])
        case .reply: ReplySheet { text in Task { await live?.reply(text) }; shownReply = text }.presentationDetents([.medium, .large])
        case .languages: NavigationStack { LanguageLists().navigationTitle(L("ios.lang.title")).navigationBarTitleDisplayMode(.inline).toolbar { Button(L("ios.done")) { sheet = nil } }.background(Color.mqBackground) }
        case .join: JoinView()
        }
      }
      .fullScreenCover(item: Binding(get: { shownReply.map(ShownReply.init) }, set: { shownReply = $0?.text })) { ShownReplyView(text: $0.text) }
      .navigationDestination(item: $openRecording) { RecordingView(recording: $0) }
      .toolbar(.hidden, for: .navigationBar)
    }
  }

  // ---------------------------------------------------------------- the top line: the pair, and how things stand

  private var header: some View {
    HStack {
      Button { sheet = .languages } label: {
        HStack(spacing: 6) {
          Text(LiveSchema.shared.name(of: prefs.source).native)
          Text("→").foregroundStyle(Color.mqText3)
          Text(LiveSchema.shared.name(of: prefs.target).native)
          Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(Color.mqText3)
        }
        .font(.subheadline.weight(.medium)).foregroundStyle(Color.mqText)
        .padding(.horizontal, 12).frame(minHeight: 36)
        .background(Color.mqSurface, in: Capsule()).overlay(Capsule().stroke(Color.mqLine))
      }
      .disabled(running) // the pair is fixed while a talk runs: changing it would cut the sentence being spoken
      .accessibilityLabel(L("ios.lang.pair", ["source": LiveSchema.shared.name(of: prefs.source).native, "target": LiveSchema.shared.name(of: prefs.target).native]))
      Spacer()
      status
    }
    .padding(.horizontal, 18).padding(.vertical, 8)
  }

  @ViewBuilder private var status: some View {
    if let live, !live.isOver || live.finished != nil || { if case .refused = live.phase { true } else { false } }() {
      TimelineView(.periodic(from: live.startedAt, by: 1)) { context in
        let elapsed = clock(Int(context.date.timeIntervalSince(live.startedAt)))
        switch live.phase {
        case .starting: StatusLabel(.neutral, L("ios.status.connecting"))
        case .listening: live.isRecording ? StatusLabel(.recording, L("ios.status.recording"), detail: elapsed) : StatusLabel(.ok, L("ios.status.listening"), detail: elapsed)
        case .reconnecting: StatusLabel(.warn, L("ios.status.reconnecting"))
        case .interrupted: StatusLabel(.warn, L("ios.status.interrupted"))
        case .refused: StatusLabel(.bad, L("ios.status.notStarted"))
        case .ended: StatusLabel(.neutral, L("ios.status.ended"))
        }
      }
    } else if let left = app.plan?.liveSecondsLeft, left <= 0 {
      StatusLabel(.bad, L("ios.status.hoursUsed"))
    } else {
      StatusLabel(.ok, L("ios.status.ready"))
    }
  }

  // ---------------------------------------------------------------- the middle

  @ViewBuilder private var content: some View {
    if let live, case .refused(let refusal) = live.phase {
      refused(refusal)
    } else if let live, !live.lines.isEmpty || !live.isOver {
      @Bindable var live = live
      ReaderView(lines: live.lines, unseen: $live.unseen, large: heldUp, speaking: !live.isOver) {
        notice(for: live)
      }
    } else {
      idle
    }
  }

  private var idle: some View {
    VStack(spacing: 14) {
      Spacer()
      Text(L("ios.live.idleTitle")).font(.mqDisplay(.largeTitle)).foregroundStyle(Color.mqText).multilineTextAlignment(.center)
      Text(L("ios.live.idleBody")).font(.mqSecondary).foregroundStyle(Color.mqText2).multilineTextAlignment(.center)
      Button { sheet = .join } label: { Label(L("ios.join.title"), systemImage: "qrcode.viewfinder") }.font(.subheadline.weight(.medium)).padding(.top, 6)
      if let problem { StatusLabel(.bad, problem).padding(.top, 8) }
      if prefs.demo { Badge(L("ios.demo.badge"), quiet: true).padding(.top, 4) }
      Spacer()
    }
    .padding(.horizontal, 36)
  }

  private func refused(_ refusal: RelayRefusal) -> some View {
    let (title, body): (String, String) = switch refusal.code {
    case "plan_talks": (L("ios.refused.talks"), L("ios.refused.talksBody"))
    case "plan_quota": (L("ios.refused.quota"), L("ios.refused.quotaBody"))
    case "bad_language": (L("ios.refused.pair"), L("ios.refused.pairBody"))
    default: (L("ios.refused.login"), L("ios.refused.loginBody"))
    }
    return VStack(spacing: 12) {
      Spacer()
      StatusLabel(.bad, title).scaleEffect(1.15)
      Text(body).font(.mqSecondary).foregroundStyle(Color.mqText2).multilineTextAlignment(.center)
      Spacer()
    }
    .padding(.horizontal, 36)
  }

  /// What sits under the last sentence when subtitles are not flowing: why, and that the recording is safe.
  @ViewBuilder private func notice(for live: LiveModel) -> some View {
    switch live.phase {
    case .reconnecting:
      Card { Text(L("ios.live.pausedTitle")).font(.headline); Text(live.isRecording ? L("ios.live.pausedBodyRec") : L("ios.live.pausedBody")).font(.mqHint).foregroundStyle(Color.mqText3) }
    case .interrupted:
      Card { Text(L("ios.live.interruptedTitle")).font(.headline); Text(L("ios.live.interruptedBody")).font(.mqHint).foregroundStyle(Color.mqText3) }
    case .ended:
      if let info = live.finished { endedCard(info, live: live) }
    default:
      EmptyView()
    }
  }

  private func endedCard(_ info: RecordingInfo, live: LiveModel) -> some View {
    Card {
      StackRow(app.library.recording(id: info.id)?.title ?? info.base,
               "\(clock(info.durationMs / 1000)) · \(L("ios.live.sentences", ["n": String(live.sentences)]))")
      HStack(spacing: 8) {
        // one filled button per view, and on this one it is Start
        Button(info.hasAudio ? L("ios.live.openRecording") : L("ios.live.openTranscript")) { openRecording = app.library.recording(id: info.id) }
          .buttonStyle(SecondaryButtonStyle())
      }
    }
    .foregroundStyle(Color.mqText)
  }

  // ---------------------------------------------------------------- the one bar

  private var bar: some View {
    @Bindable var prefs = prefs
    return VStack(spacing: 4) {
      HStack(spacing: 12) {
        if running {
          Button { Task { await live?.stop() } } label: { Label { Text(L("ios.live.stop")) } icon: { RoundedRectangle(cornerRadius: 3).fill(Color.mqRec).frame(width: 14, height: 14) } }
            .buttonStyle(SecondaryButtonStyle()).accessibilityIdentifier("stop")
          Button { sheet = .reply } label: { Image(systemName: "bubble.left") }.buttonStyle(SquareButtonStyle()).accessibilityLabel(L("ios.reply.title"))
        } else {
          Button { prefs.recordOnStart.toggle() } label: { Circle().fill(prefs.recordOnStart ? Color.mqRec : Color.mqText3).frame(width: 16, height: 16) }
            .buttonStyle(SquareButtonStyle(active: prefs.recordOnStart))
            .accessibilityLabel(L("ios.live.record")).accessibilityValue(prefs.recordOnStart ? L("common.on") : L("common.off"))
          Button(action: start) { if starting { ProgressView().tint(Color.mqOnAccent) } else { Text(startTitle) } }
            .buttonStyle(PrimaryButtonStyle()).disabled(starting).accessibilityIdentifier("start")
        }
        Button { sheet = .text } label: { Image(systemName: "textformat.size") }.buttonStyle(SquareButtonStyle()).accessibilityLabel(L("ios.text.title"))
      }
      if !running { Text(footnote).font(.mqHint).foregroundStyle(Color.mqText3) }
    }
    .padding(.horizontal, 18).padding(.top, 12).padding(.bottom, 8)
    .background(Color.mqBackground)
    .overlay(alignment: .top) { Rectangle().fill(Color.mqLine).frame(height: 1) }
  }

  private var startTitle: String { if case .refused = live?.phase { L("ios.live.tryAgain") } else { L("ios.live.start") } }

  private var footnote: String {
    let record = prefs.recordOnStart ? L("ios.live.recordOn") : L("ios.live.recordOff")
    guard let left = app.plan?.liveSecondsLeft else { return record }
    return "\(record) · \(L("ios.live.hoursLeft", ["time": hoursMinutes(left)]))"
  }

  private func start() {
    starting = true; problem = nil
    Task {
      defer { starting = false }
      do { try await app.startTalk(); barHidden = true }
      catch AppModel.StartProblem.microphoneDenied { problem = L("ios.err.microphone") }
      catch { problem = L("ios.err.start") }
    }
  }
}

struct ShownReply: Identifiable { let text: String; var id: String { text } }

/// What was typed, as large as the screen allows: to hand the phone across, or hold it up.
struct ShownReplyView: View {
  @Environment(\.dismiss) private var dismiss
  let text: String
  var body: some View {
    VStack(spacing: 0) {
      Text(text).font(.system(size: 200, weight: .bold)).minimumScaleFactor(0.08).multilineTextAlignment(.center)
        .foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity).padding(24)
      Button(L("ios.reply.back")) { dismiss() }
        .buttonStyle(SecondaryButtonStyle()).environment(\.colorScheme, .dark).padding(.horizontal, 20).padding(.bottom, 8)
    }
    .background(Color.black.ignoresSafeArea())
    .onTapGesture { dismiss() }
  }
}
