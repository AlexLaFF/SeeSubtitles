import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// A recording: the player on top, then its transcript, its summary, its files.
struct RecordingView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  @Environment(\.dismiss) private var dismiss
  let recording: Recording

  @State private var model: RecordingModel?
  @State private var player: PlayerModel?
  @State private var segment = 0
  @State private var textSheet = false
  @State private var exporting = false
  @State private var renaming = false
  @State private var deleting = false
  @State private var summariseAgain = false
  @State private var newTitle = ""

  var body: some View {
    VStack(spacing: 0) {
      if let model {
        if let player { PlayerBar(player: player) }
        Picker("", selection: $segment) {
          Text(L("ios.rec.transcript")).tag(0); Text(L("ios.rec.summary")).tag(1); Text(L("ios.rec.files")).tag(2)
        }.pickerStyle(.segmented).padding(.horizontal, 16).padding(.vertical, 10)
        switch segment {
        case 0: TranscriptList(model: model, player: player)
        case 1: summary(model)
        default: files(model)
        }
      }
    }
    .background(Color.mqBackground)
    .navigationTitle(model?.recording.title ?? recording.title)
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button { textSheet = true } label: { Label(L("ios.text.title"), systemImage: "textformat.size") }
          Button { newTitle = model?.recording.title ?? ""; renaming = true } label: { Label(L("ios.rec.rename"), systemImage: "pencil") }
          Button(role: .destructive) { deleting = true } label: { Label(L("ios.rec.delete"), systemImage: "trash") }
        } label: { Image(systemName: "ellipsis.circle") }
      }
    }
    .task {
      guard model == nil else { return }
      let m = RecordingModel(recording: recording, app: app)
      model = m
      if let audio = m.recording.audio { player = PlayerModel(url: audio) }
    }
    .onDisappear { player?.pause() }
    .sheet(isPresented: $textSheet) { TextSheet().presentationDetents([.medium]) }
    .sheet(isPresented: $exporting) { if let model { FilesExporter(urls: model.recording.files) } }
    .alert(L("ios.rec.rename"), isPresented: $renaming) {
      TextField(L("ios.rec.name"), text: $newTitle)
      Button(L("ios.cancel"), role: .cancel) {}
      Button(L("ios.save")) { if let model { try? app.library.rename(model.recording, to: newTitle); model.reload(); app.refreshLibrary() } }
    }
    .confirmationDialog(L("ios.rec.deleteAsk"), isPresented: $deleting, titleVisibility: .visible) {
      Button(L("ios.rec.delete"), role: .destructive) { player?.pause(); if let model { try? app.library.delete(model.recording) }; app.refreshLibrary(); dismiss() }
    } message: { Text(L("ios.rec.deleteBody")) }
    .confirmationDialog(L("ios.summary.againAsk"), isPresented: $summariseAgain, titleVisibility: .visible) {
      Button(L("ios.summary.again")) { model?.summarise() }
    }
  }

  // ---------------------------------------------------------------- summary

  @ViewBuilder private func summary(_ model: RecordingModel) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: Spacing.s3) {
        if case .running(let stage, _) = model.summaryWork {
          StatusLabel(.ok, stageName(stage))
          ProgressView().progressViewStyle(.linear).tint(Color.mqAccent)
        }
        if case .failed(let why) = model.summaryWork { StatusLabel(.bad, why) }
        if model.summary.isEmpty, model.summaryWork == .idle || { if case .failed = model.summaryWork { true } else { false } }() {
          VStack(spacing: 12) {
            Text(L("ios.summary.empty")).font(.mqSecondary).foregroundStyle(Color.mqText2).multilineTextAlignment(.center)
            Button { model.summarise() } label: { Label(L("ios.summary.make"), systemImage: "sparkles") }.buttonStyle(PrimaryButtonStyle()).disabled(!model.canSummarise || model.lines.isEmpty)
            if !model.canSummarise { Text(L("ios.summary.notInPlan")).font(.mqHint).foregroundStyle(Color.mqText3) }
          }.padding(.top, 40).frame(maxWidth: 360).frame(maxWidth: .infinity)
        } else {
          SummaryBody(markdown: model.summary)
          if model.summaryWork == .idle { Button(L("ios.summary.again")) { summariseAgain = true }.font(.mqSecondary).padding(.top, 8) }
        }
      }
      .padding(.horizontal, 22).padding(.vertical, 12).frame(maxWidth: 720, alignment: .leading).frame(maxWidth: .infinity)
    }
    .environment(\.openURL, OpenURLAction { url in
      guard url.scheme == "seek", let seconds = Double(url.host ?? "") else { return .systemAction }
      player?.seek(to: seconds); if player?.playing == false { player?.toggle() }
      return .handled
    })
  }

  private func stageName(_ stage: String) -> String {
    switch stage { case "thinking": L("ios.summary.thinking"); case "writing": L("ios.summary.writing"); case "condensing": L("ios.summary.condensing"); default: L("ios.summary.asking") }
  }

  // ---------------------------------------------------------------- files

  private func files(_ model: RecordingModel) -> some View {
    List {
      Section {
        ForEach(model.recording.files, id: \.self) { url in
          ShareLink(item: url) {
            StackRow(url.lastPathComponent, fileKind(url) + " · " + ByteCountFormatter.string(fromByteCount: Int64(((try? FileManager.default.attributesOfItem(atPath: url.path)[.size]) as? Int) ?? 0), countStyle: .file)) {
              Image(systemName: "square.and.arrow.up").foregroundStyle(Color.mqText3)
            }
          }.listRowBackground(Color.mqSurface)
        }
        work(model.mp4Work, title: L("ios.mp4.making"))
        work(model.resubtitleWork, title: L("ios.resub.running"))
      }
      Section(L("ios.rec.more")) {
        if model.recording.audio != nil {
          Button { model.makeMP4() } label: { action("film", model.recording.mp4 == nil ? L("ios.mp4.make") : L("ios.mp4.remake"), model.recording.durationMs > 45 * 60_000 ? L("ios.mp4.long") : L("ios.mp4.hint")) }
            .disabled(model.mp4Work != .idle && !{ if case .failed = model.mp4Work { true } else { false } }() || model.lines.isEmpty)
        }
        if model.canResubtitle {
          Button { model.resubtitle() } label: { action("icloud.and.arrow.up", L("ios.resub.make"), L("ios.resub.hint", ["time": clock(model.recording.durationMs / 1000)])) }
            .disabled(model.resubtitleWork != .idle && !{ if case .failed = model.resubtitleWork { true } else { false } }())
        }
        Button { exporting = true } label: { action("folder", L("ios.rec.saveToFiles"), nil) }
      }.listRowBackground(Color.mqSurface)
    }
    .listStyle(.insetGrouped).scrollContentBackground(.hidden)
  }

  @ViewBuilder private func work(_ state: RecordingModel.Work, title: String) -> some View {
    switch state {
    case .idle: EmptyView()
    case .running(_, let progress):
      VStack(alignment: .leading, spacing: 6) {
        HStack { Text(title); Spacer(); if let progress { Text("\(Int(progress * 100))%").font(.mqMono).foregroundStyle(Color.mqText3) } }
        if let progress { ProgressView(value: progress).tint(Color.mqAccent) } else { ProgressView().progressViewStyle(.linear).tint(Color.mqAccent) }
      }.listRowBackground(Color.mqSurface)
    case .failed(let why): StatusLabel(.bad, why).listRowBackground(Color.mqSurface)
    }
  }

  private func action(_ icon: String, _ title: String, _ hint: String?) -> some View {
    HStack(spacing: 12) {
      Image(systemName: icon).frame(width: 24)
      VStack(alignment: .leading, spacing: 2) { Text(title); if let hint { Text(hint).font(.mqHint).foregroundStyle(Color.mqText3) } }
    }
  }

  private func fileKind(_ url: URL) -> String {
    switch url.pathExtension.lowercased() { case "m4a", "aac": L("ios.file.audio"); case "srt": L("ios.file.subtitles"); case "md", "pdf": L("ios.file.summary"); case "mp4": L("ios.file.video"); default: url.pathExtension }
  }
}

struct PlayerBar: View {
  @Bindable var player: PlayerModel
  var body: some View {
    VStack(spacing: 8) {
      Slider(value: Binding(get: { player.position }, set: { player.seek(to: $0) }), in: 0...max(1, player.duration)).tint(Color.mqText2)
        .accessibilityLabel(L("ios.player.position")).accessibilityValue(clock(Int(player.position)))
      HStack { Text(clock(Int(player.position))); Spacer(); Text("-" + clock(Int(max(0, player.duration - player.position)))) }.font(.mqMono).foregroundStyle(Color.mqText3)
      HStack(spacing: 30) {
        Button { player.nextRate() } label: { Text(String(format: "%g×", player.rate)).font(.subheadline.weight(.semibold)).frame(width: 48) }.accessibilityLabel(L("ios.player.speed"))
        Button { player.skip(-15) } label: { Image(systemName: "gobackward.15").font(.title2) }.accessibilityLabel(L("ios.player.back"))
        Button { player.toggle() } label: { Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title2).frame(width: 56, height: 56).background(Color.mqText, in: Circle()).foregroundStyle(Color.mqBackground) }
          .accessibilityLabel(player.playing ? L("ios.player.pause") : L("ios.player.play")).accessibilityIdentifier("play")
        Button { player.skip(15) } label: { Image(systemName: "goforward.15").font(.title2) }.accessibilityLabel(L("ios.player.forward"))
        Spacer().frame(width: 48)
      }.foregroundStyle(Color.mqText2)
    }
    .padding(.horizontal, 20).padding(.top, 6).padding(.bottom, 10)
    .frame(maxWidth: 640).frame(maxWidth: .infinity)
    .overlay(alignment: .bottom) { Rectangle().fill(Color.mqLine).frame(height: 1) }
  }
}

/// The sentences with their times. The one being played is marked and kept in view; a tap goes there.
struct TranscriptList: View {
  @Environment(Preferences.self) private var prefs
  let model: RecordingModel
  let player: PlayerModel?
  @State private var query = ""
  @ScaledMetric(relativeTo: .body) private var base: CGFloat = 18

  private var current: String? {
    guard let player, player.position > 0 || player.playing else { return nil }
    return model.lines.last { $0.kind == .speech && model.offset(of: $0) <= player.position + 0.05 }?.id
  }

  var body: some View {
    let shown = query.isEmpty ? model.lines : model.lines.filter { $0.sourceText.localizedCaseInsensitiveContains(query) || $0.targetText.localizedCaseInsensitiveContains(query) }
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(shown) { line in
            Button { player?.seek(to: model.offset(of: line)); if player?.playing == false { player?.toggle() } } label: {
              HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(clock(Int(model.offset(of: line)))).font(.mqMono).foregroundStyle(line.id == current || line.kind == .reply ? Color.mqAccentText : Color.mqText3).frame(width: 52, alignment: .leading)
                LineView(line: line, size: base * prefs.textScale, newest: true)
              }
              .padding(.horizontal, 20).padding(.vertical, 10)
              .background(line.id == current ? Color.mqAccentSoft : Color.clear)
            }
            .buttonStyle(.plain).id(line.id)
          }
          if shown.isEmpty { Text(query.isEmpty ? L("ios.rec.noWords") : L("ios.rec.noMatch")).font(.mqSecondary).foregroundStyle(Color.mqText3).padding(24).frame(maxWidth: .infinity) }
        }
        .frame(maxWidth: 760, alignment: .leading).frame(maxWidth: .infinity)
      }
      .onChange(of: current) { _, id in if let id, player?.playing == true { withAnimation { proxy.scrollTo(id, anchor: .center) } } }
    }
    .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: L("ios.rec.searchWords"))
  }
}

/// The summary, drawn from its Markdown.
struct SummaryBody: View {
  let markdown: String
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      ForEach(Array(SummaryDocument.blocks(markdown).enumerated()), id: \.offset) { _, block in
        switch block {
        case .title(let t): Text(SummaryDocument.inline(t)).font(.title3.weight(.semibold)).foregroundStyle(Color.mqText).padding(.bottom, 2)
        case .section(let t): Text(SummaryDocument.inline(t)).font(.mqSection).foregroundStyle(Color.mqText).padding(.top, 12)
        case .subsection(let t): Text(SummaryDocument.inline(t)).font(.body.weight(.semibold)).foregroundStyle(Color.mqText).padding(.top, 6)
        case .bullet(let t): HStack(alignment: .firstTextBaseline, spacing: 8) { Text("•").foregroundStyle(Color.mqText3); Text(SummaryDocument.inline(t)).foregroundStyle(Color.mqText2) }
        case .quote(let t): Text(SummaryDocument.inline(t)).foregroundStyle(Color.mqText2).padding(.leading, 12).overlay(alignment: .leading) { Rectangle().fill(Color.mqAccent).frame(width: 2) }
        case .paragraph(let t): Text(SummaryDocument.inline(t)).foregroundStyle(Color.mqText2)
        }
      }
    }
    .font(.body).lineSpacing(4).tint(Color.mqAccentText).textSelection(.enabled)
  }
}
