import SubtitlesDesign
import SwiftUI

/// Type something for the other person to read. It fills the screen when shown, and stays in the transcript.
struct ReplySheet: View {
  @Environment(Preferences.self) private var prefs
  @Environment(\.dismiss) private var dismiss
  var show: (String) -> Void
  @State private var text = ""
  @FocusState private var focused: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: Spacing.s4) {
      Text(L("ios.reply.title")).font(.mqSection).padding(.top, Spacing.s5)
      TextField(L("ios.reply.placeholder"), text: $text, axis: .vertical).lineLimit(3...5).font(.title3).focused($focused)
        .padding(12).background(Color.mqBackground, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.mqAccent))
      if !prefs.recentReplies.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) { ForEach(prefs.recentReplies, id: \.self) { recent in Button(recent) { send(recent) }.buttonStyle(.bordered).tint(Color.mqText2) } }
        }
      }
      Button(L("ios.reply.show")) { send(text) }.buttonStyle(PrimaryButtonStyle()).disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      Text(L("ios.reply.hint")).font(.mqHint).foregroundStyle(Color.mqText3)
      Spacer(minLength: 0)
    }
    .padding(.horizontal, 20)
    .foregroundStyle(Color.mqText)
    .presentationBackground(Color.mqSurface)
    .presentationDragIndicator(.visible)
    .onAppear { focused = true }
  }

  private func send(_ value: String) { dismiss(); show(value.trimmingCharacters(in: .whitespacesAndNewlines)) }
}
