import SwiftUI

/// What a status means. The hues are the same everywhere: green ready, amber attention, red error; only
/// recording keeps the on-air red.
public enum StatusKind: Sendable { case neutral, ok, warn, bad, recording
  var color: Color { switch self { case .neutral: .mqText3; case .ok: .mqOk; case .warn: .mqWarn; case .bad: .mqBad; case .recording: .mqRec } }
}

/// A dot and a word: how every state in the app is said. Read by VoiceOver as the word alone.
public struct StatusLabel: View {
  let kind: StatusKind
  let text: String
  let detail: String?
  public init(_ kind: StatusKind, _ text: String, detail: String? = nil) { self.kind = kind; self.text = text; self.detail = detail }

  public var body: some View {
    HStack(spacing: 7) {
      Circle().fill(kind.color).frame(width: 8, height: 8)
        .overlay { if kind == .recording { Circle().stroke(kind.color.opacity(0.25), lineWidth: 4) } }
        .accessibilityHidden(true)
      Text(text).font(.mqSecondary).foregroundStyle(Color.mqText2)
      if let detail { Text(detail).font(.mqMono).foregroundStyle(Color.mqText) }
    }
    .accessibilityElement(children: .combine)
  }
}

/// The stack: a primary line and a quieter one under it. Name and what it is, translation and original.
public struct StackRow<Trailing: View>: View {
  let primary: String
  let secondary: String
  let badges: [Badge]
  let trailing: Trailing
  public init(_ primary: String, _ secondary: String, badges: [Badge] = [], @ViewBuilder trailing: () -> Trailing = { EmptyView() }) {
    self.primary = primary; self.secondary = secondary; self.badges = badges; self.trailing = trailing()
  }

  public var body: some View {
    HStack(spacing: Spacing.s3) {
      VStack(alignment: .leading, spacing: 3) {
        Text(primary).font(.body.weight(.medium)).foregroundStyle(Color.mqText).lineLimit(1)
        HStack(spacing: 6) {
          Text(secondary).font(.mqSecondary).foregroundStyle(Color.mqText3).lineLimit(1)
          ForEach(badges) { $0 }
        }
      }
      Spacer(minLength: 0)
      trailing
    }
    .accessibilityElement(children: .combine)
  }
}

public struct Badge: View, Identifiable {
  public let id: String
  let quiet: Bool
  public init(_ text: String, quiet: Bool = false) { id = text; self.quiet = quiet }
  public var body: some View {
    Text(id).font(.caption2.weight(.semibold))
      .padding(.horizontal, 6).padding(.vertical, 2)
      .background(quiet ? Color.mqSurface2 : Color.mqAccentSoft, in: RoundedRectangle(cornerRadius: 5))
      .foregroundStyle(quiet ? Color.mqText2 : Color.mqAccentText)
  }
}

/// One filled button per view: the thing to do next.
public struct PrimaryButtonStyle: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  public init() {}
  public func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.headline)
      .frame(maxWidth: .infinity, minHeight: 50)
      .background(Color.mqAccent.opacity(enabled ? (configuration.isPressed ? 0.8 : 1) : 0.4), in: RoundedRectangle(cornerRadius: 14))
      .foregroundStyle(Color.mqOnAccent)
  }
}

/// Everything else that is a button: a surface with a line round it.
public struct SecondaryButtonStyle: ButtonStyle {
  let fill: Bool
  public init(fill: Bool = true) { self.fill = fill }
  public func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.headline)
      .frame(maxWidth: fill ? .infinity : nil, minHeight: 50)
      .padding(.horizontal, fill ? 0 : 16)
      .background(Color.mqSurface.opacity(configuration.isPressed ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 14))
      .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.mqLineStrong))
      .foregroundStyle(Color.mqText)
  }
}

/// The square buttons beside the primary one on Live: record, reply, text.
public struct SquareButtonStyle: ButtonStyle {
  let active: Bool
  public init(active: Bool = false) { self.active = active }
  public func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.title3)
      .frame(width: 50, height: 50)
      .background(Color.mqSurface.opacity(configuration.isPressed ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 14))
      .overlay(RoundedRectangle(cornerRadius: 14).stroke(active ? Color.mqRec : Color.mqLineStrong))
      .foregroundStyle(Color.mqText)
  }
}

/// The mark: a long bright line over a shorter yellow one — translation over original — and the on-air dot.
/// The geometry is design/canvas/icons.mjs `stack`, in its 824-unit tile.
public struct MarkView: View {
  let size: CGFloat
  public init(size: CGFloat = 44) { self.size = size }
  public var body: some View {
    Canvas { context, _ in
      let u = size / 824
      context.fill(Path(roundedRect: CGRect(x: 0, y: 0, width: size, height: size), cornerRadius: 185 * u, style: .continuous), with: .color(Color(red: 0x13 / 255, green: 0x12 / 255, blue: 0x10 / 255)))
      context.fill(Path(ellipseIn: CGRect(x: 150 * u, y: 150 * u, width: 92 * u, height: 92 * u)), with: .color(Color(red: 1, green: 0x45 / 255, blue: 0x3a / 255)))
      context.fill(Path(roundedRect: CGRect(x: 150 * u, y: 452 * u, width: 524 * u, height: 96 * u), cornerRadius: 48 * u), with: .color(Color(red: 0xf1 / 255, green: 0xec / 255, blue: 0xe2 / 255)))
      context.fill(Path(roundedRect: CGRect(x: 232 * u, y: 596 * u, width: 360 * u, height: 72 * u), cornerRadius: 36 * u), with: .color(Color(red: 0xf5 / 255, green: 0xc5 / 255, blue: 0x18 / 255)))
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// A card: the one container that lifts off the page.
public struct Card<Content: View>: View {
  let content: Content
  public init(@ViewBuilder content: () -> Content) { self.content = content() }
  public var body: some View {
    VStack(alignment: .leading, spacing: Spacing.s3) { content }
      .padding(Spacing.s4)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Color.mqSurface, in: RoundedRectangle(cornerRadius: 16))
      .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.mqLine))
  }
}
