import ActivityKit
import SubtitlesDesign
import SwiftUI
import WidgetKit

@main
struct SeeSubtitlesWidgets: WidgetBundle {
  var body: some Widget { TalkLiveActivity() }
}

/// The talk on the lock screen and in the Dynamic Island: the clock, the sentence just spoken, and Stop. Always
/// the venue's colours — the lock screen is dark whatever the app's appearance is.
struct TalkLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: TalkActivityAttributes.self) { context in
      // The lock screen gives an activity 160 points and no more, so everything but the words is one line: the
      // languages, the state, the clock and Stop share the header, and the rest is text — four lines of it, or
      // five when the words as spoken are not shown under them.
      VStack(alignment: .leading, spacing: 5) {
        HStack(spacing: 8) {
          MarkView(size: 16)
          Text(context.attributes.pair).font(.caption2.weight(.semibold)).foregroundStyle(ink.opacity(0.75)).lineLimit(1).layoutPriority(-1)
          Spacer(minLength: 2)
          status(context)
          Button(intent: StopTalkIntent()) { Label { Text(context.attributes.stopLabel) } icon: { RoundedRectangle(cornerRadius: 2).fill(rec).frame(width: 9, height: 9) } }
            .font(.caption2.weight(.semibold)).buttonStyle(.bordered).tint(ink).controlSize(.mini)
        }
        sentence(context.state, lines: context.state.original.isEmpty ? 6 : 5)
      }
      .padding(.horizontal, 14).padding(.vertical, 10)
      .foregroundStyle(ink)
      .activityBackgroundTint(Color(red: 0x21 / 255, green: 0x20 / 255, blue: 0x1d / 255))
      .activitySystemActionForegroundColor(ink)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { dot(context.state).padding(.leading, 6) }
        DynamicIslandExpandedRegion(.trailing) { timer(context).padding(.trailing, 6) }
        DynamicIslandExpandedRegion(.bottom) { sentence(context.state, lines: 3).padding(.horizontal, 6) }
      } compactLeading: { dot(context.state) } compactTrailing: { timer(context).frame(maxWidth: 52) } minimal: { dot(context.state) }
        .keylineTint(rec)
    }
  }

  private var ink: Color { Color(red: 0xf1 / 255, green: 0xec / 255, blue: 0xe2 / 255) }
  private var rec: Color { Color(red: 1, green: 0x45 / 255, blue: 0x3a / 255) }

  private func tone(_ state: TalkActivityAttributes.ContentState) -> Color {
    state.tone == 1 ? rec : state.tone == 2 ? Color(red: 1, green: 0x8f / 255, blue: 0x1f / 255) : Color(red: 0x3e / 255, green: 0xc2 / 255, blue: 0x6a / 255)
  }

  private func dot(_ state: TalkActivityAttributes.ContentState) -> some View { Circle().fill(tone(state)).frame(width: 9, height: 9) }

  private func timer(_ context: ActivityViewContext<TalkActivityAttributes>) -> some View {
    Text(timerInterval: context.attributes.startedAt...Date.distantFuture, countsDown: false).font(.caption2.monospacedDigit().weight(.semibold)).multilineTextAlignment(.trailing)
  }

  /// The state in the header: the dot always, the clock always, the word for it only when something is wrong —
  /// "listening" beside a running clock says nothing the dot does not, and the room is needed for the words.
  private func status(_ context: ActivityViewContext<TalkActivityAttributes>) -> some View {
    HStack(spacing: 5) {
      dot(context.state)
      if context.state.tone == 2 { Text(context.state.status).font(.caption2).foregroundStyle(ink.opacity(0.7)).lineLimit(1) }
      timer(context).frame(maxWidth: 46)
    }
  }

  /// A teleprompter: the running text laid out in full and pinned to its last line, so the newest words are always
  /// at the bottom right and older ones leave by the top, fading as they go. It must read like the app's own
  /// transcript, only smaller: the words simply change. Every update of an activity is animated by the system
  /// otherwise — the old text fades out and the new one in, which at one update a second is a flicker, so both the
  /// content transition and the animation are turned off here.
  private func sentence(_ state: TalkActivityAttributes.ContentState, lines: Int) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      prompter(state.text.isEmpty ? "…" : state.text, size: 17, weight: .semibold, lines: lines, colour: ink)
      // one line: the end of the words as spoken, cut at the front so the line is always full
      if !state.original.isEmpty {
        Text(state.original).font(.system(size: 12)).foregroundStyle(ink.opacity(0.6)).lineLimit(1).truncationMode(.head)
          .contentTransition(.identity)
      }
    }
    .animation(nil, value: state.text)
    .animation(nil, value: state.original)
    .transaction { $0.animation = nil }
  }

  private func prompter(_ text: String, size: CGFloat, weight: Font.Weight, lines: Int, colour: Color) -> some View {
    let lineHeight = (size * 1.2).rounded(.up) // SF's line height at these sizes, to the point
    return Text(text)
      .font(.system(size: size, weight: weight))
      .foregroundStyle(colour)
      .contentTransition(.identity)
      .fixedSize(horizontal: false, vertical: true)
      .frame(maxWidth: .infinity, minHeight: lineHeight * CGFloat(lines), maxHeight: lineHeight * CGFloat(lines), alignment: .bottomLeading)
      .clipped()
      // the line leaving at the top fades over its own height, not over a third of the block
      .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: lines > 1 ? 0.8 / CGFloat(lines) : 0)], startPoint: .top, endPoint: .bottom))
  }
}
