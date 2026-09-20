import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// Listen: the translation spoken in headphones. One switch, the voice, the speed — and, on your own talk, the
/// reason it insists on headphones.
struct ListenSheet: View {
  @Environment(Preferences.self) private var prefs
  let spoken: SpokenTranslation
  let headphonesOnly: Bool
  var setOn: (Bool) -> Void

  var body: some View {
    @Bindable var prefs = prefs
    let voices = SystemVoice.voices(for: spoken.language)
    VStack(alignment: .leading, spacing: Spacing.s4) {
      Text(L("ios.listen.title")).font(.mqSection).padding(.top, Spacing.s5)
      Toggle(isOn: Binding(get: { spoken.isOn }, set: setOn)) {
        VStack(alignment: .leading) { Text(L("ios.listen.speak")); Text(L("ios.listen.speakHint")).font(.mqHint).foregroundStyle(Color.mqText3) }
      }.tint(Color.mqOk).disabled(!spoken.hasSomethingToSay).accessibilityIdentifier("listenToggle")
      if !spoken.hasSomethingToSay { StatusLabel(.neutral, L("ios.listen.sameLanguage")) }
      if voices.isEmpty { StatusLabel(.warn, L("ios.listen.noVoice", ["language": LiveSchema.shared.name(of: spoken.language).native])) }
      else {
        Picker(L("ios.listen.voice"), selection: Binding(get: { prefs.voiceIds[spoken.language] ?? voices[0].id }, set: { prefs.voiceIds[spoken.language] = $0 })) {
          ForEach(voices) { v in Text(v.quality > 0 ? "\(v.name) · \(L("ios.listen.enhanced"))" : v.name).tag(v.id) }
        }
        Picker(L("ios.listen.speed"), selection: $prefs.speechRate) { Text("1×").tag(1.0); Text("1.1×").tag(1.1); Text("1.25×").tag(1.25) }.pickerStyle(.segmented)
        Text(L("ios.listen.speedHint")).font(.mqHint).foregroundStyle(Color.mqText3)
      }
      if headphonesOnly {
        Card {
          StatusLabel(spoken.status == .needsHeadphones ? .warn : .neutral, L("ios.listen.headphones"))
          Text(L("ios.listen.headphonesHint")).font(.mqHint).foregroundStyle(Color.mqText3)
        }
      }
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 20)
    .foregroundStyle(Color.mqText)
    .presentationBackground(Color.mqSurface)
    .presentationDragIndicator(.visible)
  }
}

/// What Listen is doing, in one line above the bar: only there while it is on.
struct ListenStrip: View {
  let spoken: SpokenTranslation
  var body: some View {
    if spoken.isOn {
      HStack(spacing: 10) {
        Image(systemName: "headphones").foregroundStyle(Color.mqAccentText).accessibilityHidden(true)
        VStack(alignment: .leading, spacing: 1) {
          Text(title).font(.subheadline.weight(.medium)).foregroundStyle(Color.mqText)
          Text(detail).font(.mqHint).foregroundStyle(Color.mqText3)
        }
        Spacer(minLength: 0)
      }
      .padding(.horizontal, 14).padding(.vertical, 9)
      .background(spoken.status == .needsHeadphones ? Color.mqSurface2 : Color.mqAccentSoft, in: RoundedRectangle(cornerRadius: 14))
      .padding(.horizontal, 16).padding(.bottom, 10)
      .accessibilityElement(children: .combine).accessibilityIdentifier("listenStrip")
    }
  }

  private var title: String {
    spoken.status == .needsHeadphones ? L("ios.listen.connect") : L("ios.listen.speaking", ["language": LiveSchema.shared.name(of: spoken.language).native])
  }

  private var detail: String {
    if spoken.status == .needsHeadphones { return L("ios.listen.connectHint") }
    let device = AudioRoute.privateOutputName.map { "\($0) · " } ?? ""
    let counts = L("ios.listen.counts", ["spoken": String(spoken.spoken), "skipped": String(spoken.skipped)])
    return device + counts
  }
}
