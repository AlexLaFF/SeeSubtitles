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
      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          MarkView(size: 18)
          Text(context.attributes.pair).font(.caption.weight(.semibold)).foregroundStyle(ink.opacity(0.75)).lineLimit(1)
          Spacer(minLength: 4)
          status(context)
        }
        sentence(context.state, lines: context.state.original.isEmpty ? 3 : 2)
        HStack {
          Spacer()
          Button(intent: StopTalkIntent()) { Label { Text(context.attributes.stopLabel) } icon: { RoundedRectangle(cornerRadius: 2).fill(rec).frame(width: 10, height: 10) } }
            .font(.footnote.weight(.semibold)).buttonStyle(.bordered).tint(ink).controlSize(.small)
        }
      }
      .padding(.horizontal, 14).padding(.vertical, 12)
      .foregroundStyle(ink)
      .activityBackgroundTint(Color(red: 0x21 / 255, green: 0x20 / 255, blue: 0x1d / 255))
      .activitySystemActionForegroundColor(ink)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { dot(context.state).padding(.leading, 6) }
        DynamicIslandExpandedRegion(.trailing) { timer(context).padding(.trailing, 6) }
        DynamicIslandExpandedRegion(.bottom) { sentence(context.state, lines: 2).padding(.horizontal, 6) }
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
    Text(timerInterval: context.attributes.startedAt...Date.distantFuture, countsDown: false).font(.footnote.monospacedDigit().weight(.semibold)).multilineTextAlignment(.trailing)
  }

  private func status(_ context: ActivityViewContext<TalkActivityAttributes>) -> some View {
    HStack(spacing: 6) { dot(context.state); Text(context.state.status).font(.caption).foregroundStyle(ink.opacity(0.7)); timer(context).frame(maxWidth: 58) }
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
      .mask(LinearGradient(stops: [.init(color: .clear, location: 0), .init(color: .black, location: lines > 1 ? 0.35 : 0)], startPoint: .top, endPoint: .bottom))
  }
}
