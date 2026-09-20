import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// The transcript as something to read: large, following the newest sentence until the reader scrolls back, and
/// then waiting — with a count of what has arrived since — until they ask for the latest. Used by Live, by a
/// joined talk, and (without following) nowhere else: a recording's transcript has timestamps and a player.
struct ReaderView<Footer: View>: View {
  @Environment(Preferences.self) private var prefs
  let lines: [TranscriptLine]
  @Binding var unseen: Int
  /// Held up in landscape: larger, and nothing else on screen.
  var large = false
  /// Whether words are still arriving. When they are not, a sentence cut short is simply short: nothing is "still being spoken".
  var speaking = true
  @ViewBuilder var footer: Footer

  @State private var atBottom = true
  @ScaledMetric(relativeTo: .title2) private var base: CGFloat = 25

  var body: some View {
    ScrollViewReader { proxy in
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 20) {
          ForEach(lines) { line in
            LineView(line: line, size: base * prefs.textScale * (large ? 1.5 : 1), newest: line.id == lines.last?.id, speaking: speaking)
          }
          footer
          // Whether this is on screen is whether the reader is at the newest sentence.
          Color.clear.frame(height: 1).id("bottom")
            .onAppear { atBottom = true; unseen = 0 }
            .onDisappear { atBottom = false }
        }
        .padding(.horizontal, large ? 48 : 22).padding(.vertical, 18)
      }
      .defaultScrollAnchor(.bottom) // stays with the newest sentence as the talk grows, until the reader moves away
      .overlay(alignment: .bottom) {
        if !atBottom, unseen > 0 {
          Button { withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } } label: {
            Label(L("ios.live.jump", ["n": String(unseen)]), systemImage: "arrow.down")
              .font(.subheadline.weight(.semibold)).padding(.horizontal, 16).frame(height: 38)
              .background(Color.mqAccent, in: Capsule()).foregroundStyle(Color.mqOnAccent).shadow(color: .black.opacity(0.35), radius: 10, y: 4)
          }
          .padding(.bottom, 14).transition(.move(edge: .bottom).combined(with: .opacity))
        }
      }
      .onChange(of: lines.last?.display) { if atBottom { unseen = 0 } }
    }
    .background(prefs.highContrast ? Color.black : Color.mqBackground)
  }
}

/// One sentence: the stack from the design language. Translation first, the original quieter under it.
struct LineView: View {
  @Environment(Preferences.self) private var prefs
  let line: TranscriptLine
  let size: CGFloat
  let newest: Bool
  var speaking = false

  private var weight: Font.Weight { [.regular, .semibold, .bold][min(2, max(0, prefs.textWeight))] }

  var body: some View {
    if line.kind == .reply { reply } else { speech }
  }

  private var speech: some View {
    let transcribing = line.targetText.isEmpty || line.targetText == line.sourceText
    let primary = prefs.showMode == .source || transcribing ? line.sourceText : line.targetText
    let secondary = prefs.showMode == .both && !transcribing ? line.sourceText : ""
    let strong = prefs.highContrast ? Color.white : Color.mqText
    let soft = prefs.highContrast ? Color.white.opacity(0.85) : Color.mqText2
    return VStack(alignment: .leading, spacing: 5) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(primary.isEmpty ? line.display : primary).font(.system(size: size, weight: weight)).foregroundStyle(line.ended && newest || !line.ended ? strong : soft)
        if !line.ended, speaking { Circle().fill(Color.mqAccent).frame(width: 9, height: 9).accessibilityHidden(true) } // still being spoken
      }
      if !secondary.isEmpty { Text(secondary).font(.system(size: size * 0.64)).foregroundStyle(prefs.highContrast ? Color.white.opacity(0.7) : Color.mqText3) }
    }
    .lineSpacing(size * 0.12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }

  private var reply: some View {
    Text(line.sourceText).font(.system(size: size * 0.78, weight: .medium)).foregroundStyle(prefs.highContrast ? Color.white : Color.mqText)
      .padding(.horizontal, 14).padding(.vertical, 10)
      .background(Color.mqAccentSoft, in: UnevenRoundedRectangle(topLeadingRadius: 16, bottomLeadingRadius: 16, bottomTrailingRadius: 4, topTrailingRadius: 16))
      .frame(maxWidth: .infinity, alignment: .trailing)
      .accessibilityLabel(L("ios.reply.yours", ["text": line.sourceText]))
  }
}
