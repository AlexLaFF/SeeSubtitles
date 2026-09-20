import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// The recordings on this phone, newest first. On iPad the list sits beside the recording it opens.
struct LibraryView: View {
  @Environment(AppModel.self) private var app
  var startTalk: () -> Void
  @State private var query = ""
  @State private var selected: Recording.ID?
  @State private var renaming: Recording?
  @State private var deleting: Recording?
  @State private var newTitle = ""

  private var shown: [Recording] { app.library.search(query, in: app.recordings) }

  var body: some View {
    NavigationSplitView {
      Group {
        if app.recordings.isEmpty { empty } else { list }
      }
      .navigationTitle(L("ios.tab.library"))
      .background(Color.mqBackground)
    } detail: {
      if let id = selected, let recording = app.recordings.first(where: { $0.id == id }) {
        RecordingView(recording: recording).id(recording.id)
      } else {
        Text(L("ios.library.pick")).font(.mqSecondary).foregroundStyle(Color.mqText3).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.mqBackground)
      }
    }
    .onAppear { app.refreshLibrary() }
    .alert(L("ios.rec.rename"), isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
      TextField(L("ios.rec.name"), text: $newTitle)
      Button(L("ios.cancel"), role: .cancel) {}
      Button(L("ios.save")) { if let r = renaming { try? app.library.rename(r, to: newTitle); app.refreshLibrary() } }
    }
    .confirmationDialog(L("ios.rec.deleteAsk"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
      Button(L("ios.rec.delete"), role: .destructive) { if let r = deleting { if selected == r.id { selected = nil }; try? app.library.delete(r); app.refreshLibrary() } }
    } message: { Text(L("ios.rec.deleteBody")) }
  }

  private var list: some View {
    List(selection: $selected) {
      if !app.recovered.isEmpty { Section { StatusLabel(.ok, L("ios.library.recovered", ["n": String(app.recovered.count)])) }.listRowBackground(Color.mqSurface) }
      Section {
        ForEach(shown) { r in
          StackRow(r.title, RecordingFormat.subtitle(r), badges: RecordingFormat.badges(r)) { EmptyView() }
            .padding(.vertical, 2).tag(r.id)
            .listRowBackground(Color.mqSurface)
            .swipeActions(edge: .trailing) {
              Button(role: .destructive) { deleting = r } label: { Label(L("ios.rec.delete"), systemImage: "trash") }
              if let first = r.files.first { ShareLink(item: first) { Label(L("ios.share"), systemImage: "square.and.arrow.up") }.tint(Color.mqText3) }
            }
            .contextMenu {
              Button { newTitle = r.title; renaming = r } label: { Label(L("ios.rec.rename"), systemImage: "pencil") }
              Button(role: .destructive) { deleting = r } label: { Label(L("ios.rec.delete"), systemImage: "trash") }
            }
        }
      } footer: {
        Text(L("ios.library.footer", ["n": String(app.recordings.count), "size": ByteCountFormatter.string(fromByteCount: Int64(app.recordings.reduce(0) { $0 + $1.bytes }), countStyle: .file)]))
      }
    }
    .listStyle(.insetGrouped)
    .scrollContentBackground(.hidden)
    .searchable(text: $query, prompt: L("ios.library.search"))
  }

  private var empty: some View {
    VStack(spacing: 14) {
      Text(L("ios.library.emptyTitle")).font(.mqDisplay(.largeTitle)).foregroundStyle(Color.mqText).multilineTextAlignment(.center)
      Text(L("ios.library.emptyBody")).font(.mqSecondary).foregroundStyle(Color.mqText2).multilineTextAlignment(.center)
      Button(L("ios.library.start"), action: startTalk).buttonStyle(PrimaryButtonStyle()).frame(maxWidth: 240).padding(.top, 6)
    }
    .padding(.horizontal, 36).frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// How a recording is described in one line: the pair, how long, when.
@MainActor
enum RecordingFormat {
  static func pair(_ r: Recording) -> String {
    let s = LiveSchema.shared
    let target = s.fileLabels[r.manifest.target] ?? s.name(of: r.manifest.target).native
    return "\(s.name(of: r.manifest.source).native) → \(target)"
  }

  static func day(_ date: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: Localizer.isChinese ? "zh-Hans" : "en")
    f.doesRelativeDateFormatting = true
    f.dateStyle = .medium; f.timeStyle = .none
    return f.string(from: date)
  }

  static func subtitle(_ r: Recording) -> String { "\(pair(r)) · \(clock(r.durationMs / 1000)) · \(day(r.date))" }

  static func badges(_ r: Recording) -> [Badge] {
    var out: [Badge] = []
    if r.summary != nil { out.append(Badge(L("ios.badge.summary"))) }
    if r.mp4 != nil { out.append(Badge("MP4")) }
    if r.resubtitled { out.append(Badge(L("ios.badge.resubtitled"), quiet: true)) }
    if r.manifest.kind == .joined { out.append(Badge(L("ios.badge.joined"), quiet: true)) }
    if r.manifest.kind == .transcriptOnly { out.append(Badge(L("ios.badge.transcript"), quiet: true)) }
    if r.manifest.recovered == true { out.append(Badge(L("ios.badge.recovered"), quiet: true)) }
    return out
  }
}
