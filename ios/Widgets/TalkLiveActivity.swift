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
      VStack(alignment: .leading, spacing: 8) {
        HStack(spacing: 8) {
          MarkView(size: 20)
          Text("See Subtitles").font(.footnote.weight(.semibold))
          Spacer()
          status(context)
        }
        sentence(context.state).frame(maxWidth: .infinity, alignment: .leading)
        HStack {
          Text(context.attributes.pair).font(.caption).foregroundStyle(ink.opacity(0.6))
          Spacer()
          Button(intent: StopTalkIntent()) { Label { Text(context.attributes.stopLabel) } icon: { RoundedRectangle(cornerRadius: 2).fill(rec).frame(width: 10, height: 10) } }
            .font(.footnote.weight(.semibold)).buttonStyle(.bordered).tint(ink)
        }
      }
      .padding(14)
      .foregroundStyle(ink)
      .activityBackgroundTint(Color(red: 0x21 / 255, green: 0x20 / 255, blue: 0x1d / 255))
      .activitySystemActionForegroundColor(ink)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { dot(context.state).padding(.leading, 6) }
        DynamicIslandExpandedRegion(.trailing) { timer(context).padding(.trailing, 6) }
        DynamicIslandExpandedRegion(.bottom) { sentence(context.state).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 6) }
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

  private func sentence(_ state: TalkActivityAttributes.ContentState) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(state.text.isEmpty ? "…" : state.text).font(.body.weight(.semibold)).lineLimit(3)
      if !state.original.isEmpty { Text(state.original).font(.caption).foregroundStyle(ink.opacity(0.6)).lineLimit(2) }
    }
  }
}
