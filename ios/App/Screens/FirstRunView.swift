import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// First run, after logging in: why the microphone, then which two languages. Then Live, idle.
struct FirstRunView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  @State private var step = 0

  var body: some View {
    VStack(spacing: 0) {
      if step == 0 { microphone } else { languages }
      HStack(spacing: 7) { ForEach(0..<2, id: \.self) { i in Circle().fill(i == step ? Color.mqAccent : Color.mqText3).frame(width: 7, height: 7) } }
        .padding(.vertical, Spacing.s3).accessibilityHidden(true)
    }
    .frame(maxWidth: 520)
  }

  private var microphone: some View {
    VStack(alignment: .leading, spacing: Spacing.s4) {
      Spacer()
      Image(systemName: "mic").font(.title).foregroundStyle(Color.mqAccentText)
        .frame(width: 64, height: 64).background(Color.mqAccentSoft, in: RoundedRectangle(cornerRadius: 20)).accessibilityHidden(true)
      Text(L("ios.first.micTitle")).font(.mqViewTitle).foregroundStyle(Color.mqText)
      Text(L("ios.first.micBody")).font(.mqSecondary).foregroundStyle(Color.mqText2)
      Text(L("ios.first.micHint")).font(.mqHint).foregroundStyle(Color.mqText3)
      Button(L("ios.first.micAllow")) { Task { _ = await app.microphoneAllowed(); step = 1 } }.buttonStyle(PrimaryButtonStyle()).padding(.top, Spacing.s4)
      Button(L("ios.first.notNow")) { step = 1 }.frame(maxWidth: .infinity, minHeight: 44)
    }
    .padding(.horizontal, Spacing.s5)
  }

  private var languages: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text(L("ios.first.langTitle")).font(.mqViewTitle).foregroundStyle(Color.mqText).padding(.horizontal, Spacing.s5).padding(.top, Spacing.s5)
      LanguageLists()
      Button(L("ios.first.done")) { prefs.firstRunDone = true }.buttonStyle(PrimaryButtonStyle()).padding(.horizontal, Spacing.s5)
    }
  }
}

/// The two lists: what is spoken, what the subtitles are in. Choosing the first narrows the second, because only
/// pairs the relay accepts are offered.
struct LanguageLists: View {
  @Environment(Preferences.self) private var prefs
  @State private var showAllSources = false

  var body: some View {
    let schema = LiveSchema.shared
    let sources = schema.sources(pipeline: "mixed") + schema.sources()
    let shown = showAllSources || !sources.prefix(5).contains(prefs.source) ? sources : Array(sources.prefix(5))
    List {
      Section(L("ios.lang.spoken")) {
        ForEach(shown, id: \.self) { code in row(code, selected: prefs.source == code) { prefs.setSource(code) } }
        if shown.count < sources.count { Button(L("ios.lang.more", ["n": String(sources.count - shown.count)])) { showAllSources = true } }
      }
      Section {
        ForEach(schema.targets(for: prefs.source, pipeline: prefs.pipeline), id: \.self) { code in
          row(code, selected: prefs.target == code, note: code == prefs.source ? L("ios.lang.asSpoken") : nil) { prefs.target = code }
        }
      } header: { Text(L("ios.lang.subtitles")) } footer: { Text(L("ios.lang.hint")) }
    }
    .scrollContentBackground(.hidden)
    .listStyle(.insetGrouped)
  }

  private func row(_ code: String, selected: Bool, note: String? = nil, pick: @escaping () -> Void) -> some View {
    let name = LiveSchema.shared.name(of: code)
    return Button(action: pick) {
      HStack {
        Text(name.native).foregroundStyle(Color.mqText)
        Text(note ?? name.english).foregroundStyle(Color.mqText3)
        Spacer()
        if selected { Image(systemName: "checkmark").foregroundStyle(Color.mqAccentText).fontWeight(.semibold) }
      }
    }
    .listRowBackground(Color.mqSurface)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }
}
