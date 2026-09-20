import SwiftUI
import UIKit

/// A summary's Markdown, read into the few shapes a summary has (core/summary.js asks for exactly these): a
/// title, sections, sub-sections, bullets, the odd quote. Timestamps like [12:34] become links the player follows.
enum SummaryDocument {
  enum Block: Identifiable, Equatable {
    case title(String), section(String), subsection(String), bullet(String), quote(String), paragraph(String)
    var id: String { String(describing: self) }
  }

  static func blocks(_ markdown: String) -> [Block] {
    var out: [Block] = []
    let body = markdown.replacing(/<!--[\s\S]*?-->/, with: "")
    for raw in body.split(separator: "\n", omittingEmptySubsequences: true) {
      let line = raw.trimmingCharacters(in: .whitespaces)
      if line.isEmpty { continue }
      if line.hasPrefix("### ") { out.append(.subsection(String(line.dropFirst(4)))) }
      else if line.hasPrefix("## ") { out.append(.section(String(line.dropFirst(3)))) }
      else if line.hasPrefix("# ") { out.append(.title(String(line.dropFirst(2)))) }
      else if line.hasPrefix("- ") || line.hasPrefix("* ") { out.append(.bullet(String(line.dropFirst(2)))) }
      else if line.hasPrefix("> ") { out.append(.quote(String(line.dropFirst(2)))) }
      else { out.append(.paragraph(line)) }
    }
    return out
  }

  /// "[1:02:03]" or "[12:34]" → seconds.
  static func seconds(_ stamp: Substring) -> Int { stamp.split(separator: ":").reduce(0) { $0 * 60 + (Int($1) ?? 0) } }

  /// Inline Markdown (bold) with timestamps turned into seek: links.
  static func inline(_ text: String) -> AttributedString {
    let linked = text.replacing(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/) { m in "[\(m.1)](seek://\(seconds(m.1)))" }
    return (try? AttributedString(markdown: linked, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
  }

  // ---------------------------------------------------------------- PDF

  static func html(markdown: String, title: String) -> String {
    func esc(_ s: String) -> String { s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;") }
    func rich(_ s: String) -> String {
      esc(s).replacing(/\*\*(.+?)\*\*/) { "<b>\($0.1)</b>" }.replacing(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/) { "<span class=\"ts\">\($0.1)</span>" }
    }
    var body = ""
    var inList = false
    for block in blocks(markdown) {
      if case .bullet(let text) = block { if !inList { body += "<ul>"; inList = true }; body += "<li>\(rich(text))</li>"; continue }
      if inList { body += "</ul>"; inList = false }
      switch block {
      case .title(let t): body += "<h1>\(rich(t))</h1>"
      case .section(let t): body += "<h2>\(rich(t))</h2>"
      case .subsection(let t): body += "<h3>\(rich(t))</h3>"
      case .quote(let t): body += "<blockquote>\(rich(t))</blockquote>"
      case .paragraph(let t): body += "<p>\(rich(t))</p>"
      case .bullet: break
      }
    }
    if inList { body += "</ul>" }
    return """
    <html><head><meta charset="utf-8"><style>
    body{font:11.5pt/1.6 -apple-system,"PingFang SC",sans-serif;color:#1c1a16} h1{font-size:20pt;margin:0 0 4pt} h2{font-size:13pt;margin:18pt 0 4pt;border-bottom:.5pt solid #c4bdae;padding-bottom:3pt}
    h3{font-size:11.5pt;margin:12pt 0 3pt} ul{margin:0;padding-left:16pt} li{margin-bottom:3pt} .ts{font:9pt ui-monospace,Menlo,monospace;color:#8f6a00} blockquote{margin:6pt 0;padding-left:10pt;border-left:2pt solid #f5c518;color:#6a6458}
    .meta{font-size:9pt;color:#948d80;margin-bottom:14pt}
    </style></head><body><div class="meta">\(esc(title)) · See Subtitles</div>\(body)</body></html>
    """
  }

  /// A4, paginated by the system's own HTML printer.
  @MainActor static func pdf(markdown: String, title: String) -> Data {
    let renderer = UIPrintPageRenderer()
    renderer.addPrintFormatter(UIMarkupTextPrintFormatter(markupText: html(markdown: markdown, title: title)), startingAtPageAt: 0)
    let page = CGRect(x: 0, y: 0, width: 595.2, height: 841.8)
    renderer.setValue(page, forKey: "paperRect")
    renderer.setValue(page.insetBy(dx: 50, dy: 56), forKey: "printableRect")
    let data = NSMutableData()
    UIGraphicsBeginPDFContextToData(data, page, nil)
    renderer.prepare(forDrawingPages: NSRange(location: 0, length: renderer.numberOfPages))
    for i in 0..<renderer.numberOfPages { UIGraphicsBeginPDFPage(); renderer.drawPage(at: i, in: UIGraphicsGetPDFContextBounds()) }
    UIGraphicsEndPDFContext()
    return data as Data
  }
}

/// "Save to Files": the system's own picker, copying the recording's files wherever the person chooses.
struct FilesExporter: UIViewControllerRepresentable {
  let urls: [URL]
  func makeUIViewController(context: Context) -> UIDocumentPickerViewController { UIDocumentPickerViewController(forExporting: urls, asCopy: true) }
  func updateUIViewController(_ controller: UIDocumentPickerViewController, context: Context) {}
}
