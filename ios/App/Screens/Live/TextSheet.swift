import SubtitlesDesign
import SwiftUI

/// How the words look: which of the two texts, how large, how heavy, and whether to give up everything for
/// contrast. Applied as it is changed; serves Live, a joined talk and a recording's transcript alike.
struct TextSheet: View {
  @Environment(Preferences.self) private var prefs

  var body: some View {
    @Bindable var prefs = prefs
    VStack(alignment: .leading, spacing: Spacing.s4) {
      Text(L("ios.text.title")).font(.mqSection).padding(.top, Spacing.s5)
      Picker(L("ios.text.show"), selection: $prefs.showMode) {
        Text(L("ios.text.translation")).tag(ShowMode.target)
        Text(L("ios.text.both")).tag(ShowMode.both)
        Text(L("ios.text.original")).tag(ShowMode.source)
      }.pickerStyle(.segmented)
      HStack(spacing: 12) {
        Text("A").font(.footnote.weight(.semibold)).accessibilityHidden(true)
        Slider(value: $prefs.textScale, in: 0.7...2.4, step: 0.05).tint(Color.mqAccent).accessibilityLabel(L("ios.text.size"))
        Text("A").font(.title2.weight(.semibold)).accessibilityHidden(true)
      }
      Picker(L("ios.text.weight"), selection: $prefs.textWeight) {
        Text(L("ios.text.regular")).tag(0); Text(L("ios.text.semibold")).tag(1); Text(L("ios.text.bold")).tag(2)
      }.pickerStyle(.segmented)
      Toggle(isOn: $prefs.highContrast) { VStack(alignment: .leading) { Text(L("ios.text.contrast")); Text(L("ios.text.contrastHint")).font(.mqHint).foregroundStyle(Color.mqText3) } }
      Toggle(isOn: $prefs.haptics) { VStack(alignment: .leading) { Text(L("ios.text.haptics")); Text(L("ios.text.hapticsHint")).font(.mqHint).foregroundStyle(Color.mqText3) } }
      Spacer(minLength: 0)
    }
    .tint(Color.mqOk)
    .padding(.horizontal, 20)
    .foregroundStyle(Color.mqText)
    .presentationBackground(Color.mqSurface)
    .presentationDragIndicator(.visible)
  }
}
