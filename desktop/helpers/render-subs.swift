// Renders subtitle frames for the MP4 export: a bottom-anchored stack of the latest cues (current one
// bright, earlier ones dimmed), like the live display. Writes PNGs plus an ffconcat list.
//
//   render-subs --zh a.zh.srt [--yue a.yue.srt] --out DIR --width 1080 --height 1920 --font-size 64
//               --duration SECONDS [--show target|both] [--lines 4]
import AppKit
import CoreText
import Foundation

struct Cue { var start: Double; var end: Double; var zh: String; var yue: String }

let args = CommandLine.arguments
func arg(_ name: String, _ def: String) -> String { if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }; return def }
func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(2) }

let zhPath = arg("--zh", "")
let yuePath = arg("--yue", "")
let outDir = arg("--out", "")
let W = Int(arg("--width", "1080")) ?? 1080
let H = Int(arg("--height", "1920")) ?? 1920
let fontSize = CGFloat(Double(arg("--font-size", "64")) ?? 64)
let duration = Double(arg("--duration", "0")) ?? 0
let showBoth = arg("--show", "target") == "both"
let maxLines = Int(arg("--lines", "4")) ?? 4
if outDir.isEmpty || duration <= 0 { fail("usage: --zh file --out dir --duration seconds") }

func parseSRT(_ path: String) -> [(Double, Double, String)] {
  guard !path.isEmpty, let s = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
  let re = try! NSRegularExpression(pattern: "(\\d+):(\\d+):(\\d+),(\\d+)\\s*-->\\s*(\\d+):(\\d+):(\\d+),(\\d+)")
  var out: [(Double, Double, String)] = []
  for block in s.replacingOccurrences(of: "\r", with: "").components(separatedBy: "\n\n") {
    let lines = block.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
    guard lines.count >= 2 else { continue }
    let ti = lines[1].contains("-->") ? 1 : 0
    let line = lines[ti]
    guard let m = re.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)) else { continue }
    func g(_ i: Int) -> Double { Double(line[Range(m.range(at: i), in: line)!]) ?? 0 }
    let start = g(1) * 3600 + g(2) * 60 + g(3) + g(4) / 1000
    let end = g(5) * 3600 + g(6) * 60 + g(7) + g(8) / 1000
    out.append((start, end, lines[(ti + 1)...].joined(separator: "\n")))
  }
  return out
}

let zh = parseSRT(zhPath)
let yue = parseSRT(yuePath)
var cues: [Cue] = zh.map { c in
  let y = yue.first { abs($0.0 - c.0) < 0.05 }?.2 ?? ""
  return Cue(start: c.0, end: c.1, zh: c.2, yue: y)
}
if cues.isEmpty { cues = yue.map { Cue(start: $0.0, end: $0.1, zh: $0.2, yue: "") } }
cues.sort { $0.start < $1.start }

// ---- text rendering (CoreText)
let padX = CGFloat(W) * 0.05
let padBottom = CGFloat(H) * 0.08
let padTop = CGFloat(H) * 0.03
let textW = CGFloat(W) - 2 * padX
let gap = fontSize * 0.5
let mainFont = NSFont.systemFont(ofSize: fontSize, weight: .bold) // system font falls back to PingFang for CJK
let subFont = NSFont.systemFont(ofSize: fontSize * 0.55, weight: .medium)

func paragraph() -> CTParagraphStyle {
  var alignment = CTTextAlignment.center
  var lhm: CGFloat = 1.12
  return withUnsafePointer(to: &alignment) { ap in
    withUnsafePointer(to: &lhm) { lp in
      let settings = [
        CTParagraphStyleSetting(spec: .alignment, valueSize: MemoryLayout<CTTextAlignment>.size, value: ap),
        CTParagraphStyleSetting(spec: .lineHeightMultiple, valueSize: MemoryLayout<CGFloat>.size, value: lp),
      ]
      return CTParagraphStyleCreate(settings, settings.count)
    }
  }
}
let para = paragraph()

// Two passes per cue: an outline-only pass (black stroke) underneath, then a clean white fill on top,
// so bold CJK strokes do not look hollow.
func attributed(_ cue: Cue, bright: Bool, outline: Bool) -> NSAttributedString {
  let alpha: CGFloat = bright ? 1.0 : 0.55
  func attrs(_ font: NSFont, _ a: CGFloat) -> [NSAttributedString.Key: Any] {
    var d: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): font,
      NSAttributedString.Key(kCTParagraphStyleAttributeName as String): para,
    ]
    if outline {
      d[NSAttributedString.Key(kCTStrokeColorAttributeName as String)] = CGColor(gray: 0, alpha: 0.9)
      d[NSAttributedString.Key(kCTStrokeWidthAttributeName as String)] = 9.0 // stroke only, % of font size
    } else {
      d[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = CGColor(gray: 1, alpha: a)
    }
    return d
  }
  let s = NSMutableAttributedString(string: cue.zh.isEmpty ? cue.yue : cue.zh, attributes: attrs(mainFont, alpha))
  if showBoth && !cue.yue.isEmpty && !cue.zh.isEmpty {
    s.append(NSAttributedString(string: "\n" + cue.yue, attributes: attrs(subFont, alpha * 0.8)))
  }
  return s
}

func height(_ a: NSAttributedString) -> CGFloat {
  let fs = CTFramesetterCreateWithAttributedString(a)
  let size = CTFramesetterSuggestFrameSizeWithConstraints(fs, CFRange(location: 0, length: 0), nil, CGSize(width: textW, height: 100000), nil)
  return ceil(size.height) + 4
}

func draw(_ a: NSAttributedString, top: CGFloat, height h: CGFloat, in ctx: CGContext) {
  // rect gets extra slack below so CoreText never drops the last line; text is laid out from the top
  let slack = fontSize
  let rect = CGPath(rect: CGRect(x: padX, y: top - h - slack, width: textW, height: h + slack), transform: nil)
  let frame = CTFramesetterCreateFrame(CTFramesetterCreateWithAttributedString(a), CFRange(location: 0, length: 0), rect, nil)
  CTFrameDraw(frame, ctx)
}

func render(_ state: [(Cue, Bool)], to path: String) {
  guard let ctx = CGContext(data: nil, width: W, height: H, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no graphics context") }
  ctx.setFillColor(CGColor(gray: 0, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))
  var y = padBottom // CoreGraphics origin is bottom-left: stack upward from the bottom padding
  for (cue, bright) in state.reversed() {
    let fill = attributed(cue, bright: bright, outline: false)
    let h = height(fill)
    if y > CGFloat(H) - padTop { break }
    draw(attributed(cue, bright: bright, outline: true), top: y + h, height: h, in: ctx)
    draw(fill, top: y + h, height: h, in: ctx)
    y += h + gap
  }
  guard let img = ctx.makeImage(), let png = NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:]) else { fail("png encode failed") }
  do { try png.write(to: URL(fileURLWithPath: path)) } catch { fail("write failed: \(error)") }
}

// ---- timeline → segments (state changes at every cue start and end)
var times = Set<Double>([0])
for c in cues { times.insert(c.start); times.insert(min(c.end, duration)) }
let sorted = times.filter { $0 >= 0 && $0 < duration }.sorted()
var list = "ffconcat version 1.0\n"
var cache: [String: String] = [:]
var frames = 0
var segments = 0
var lastFile = ""
for (k, t) in sorted.enumerated() {
  let next = k + 1 < sorted.count ? sorted[k + 1] : duration
  if next - t < 0.001 { continue }
  let visible = cues.enumerated().filter { $0.element.start <= t + 1e-6 }.suffix(maxLines)
  let state = visible.map { ($0.element, $0.element.end > t + 1e-6) }
  let key = visible.map { "\($0.offset):\($0.element.end > t + 1e-6 ? 1 : 0)" }.joined(separator: ",")
  let file: String
  if let f = cache[key] { file = f } else {
    frames += 1
    file = String(format: "f%05d.png", frames)
    render(state, to: (outDir as NSString).appendingPathComponent(file))
    cache[key] = file
  }
  list += "file '\(file)'\nduration \(String(format: "%.3f", next - t))\n"
  lastFile = file
  segments += 1
}
list += "file '\(lastFile)'\n" // concat demuxer needs the last file repeated to honour its duration
do { try list.write(toFile: (outDir as NSString).appendingPathComponent("concat.txt"), atomically: true, encoding: .utf8) } catch { fail("write failed: \(error)") }
print("{\"frames\":\(frames),\"segments\":\(segments),\"cues\":\(cues.count)}")
