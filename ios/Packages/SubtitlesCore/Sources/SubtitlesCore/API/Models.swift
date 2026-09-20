import Foundation

/// An answer from the server that was not a success. `code` is what the app translates (`bad_login`,
/// `totp_required`, `plan_summaries`, …); `message` is the server's English sentence, for logs.
public struct APIError: Error, Sendable, Equatable, LocalizedError {
  public let status: Int
  public let code: String?
  public let message: String
  public init(status: Int, code: String?, message: String) { self.status = status; self.code = code; self.message = message }
  public var errorDescription: String? { message }
  public var isUnauthorized: Bool { status == 401 && code == nil }
}

public struct User: Codable, Sendable, Equatable {
  public let id: Int
  public let email: String
  public let role: String?
}

/// The account's plan as `/api/me` reports it: limits in seconds (nil = unlimited) and what the month has used.
public struct Plan: Codable, Sendable, Equatable {
  public struct Limits: Codable, Sendable, Equatable {
    public let liveSeconds: Double?
    public let fileSeconds: Double?
    public let talks: Int?
    public let sharing: Bool
    public let summaries: Bool
  }
  public struct Used: Codable, Sendable, Equatable { public let liveSeconds: Double; public let fileSeconds: Double }
  public struct Team: Codable, Sendable, Equatable { public let name: String?; public let member: Bool? }

  public let plan: String
  public let name: String
  public let month: String
  public let team: Team?
  public let limits: Limits
  public let used: Used

  /// Live seconds left this month; nil when the plan has no limit.
  public var liveSecondsLeft: Double? { limits.liveSeconds.map { max(0, $0 - used.liveSeconds) } }
}

public struct Account: Codable, Sendable, Equatable {
  public let user: User
  public let plan: Plan
}

public struct GlossaryItem: Codable, Sendable, Equatable, Identifiable {
  public var term: String
  /// 1–11, or 100 to force the term.
  public var weight: Int
  public var note: String?
  public var id: String { term.lowercased() }
  public init(term: String, weight: Int = 6, note: String? = nil) { self.term = term; self.weight = weight; self.note = note }
}

public struct Glossary: Codable, Sendable, Equatable {
  public var items: [GlossaryItem]
  public var updatedAt: Double?
  public init(items: [GlossaryItem], updatedAt: Double?) { self.items = items; self.updatedAt = updatedAt }
  /// The text the recogniser takes: one `词|权重` per line (server/lib/account.js hotwordsText).
  public var hotwords: String { items.map { "\($0.term)|\($0.weight)" }.joined(separator: "\n") }
}

/// A place this account is signed in.
public struct Device: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let kind: String
  public let label: String
  public let created_at: Double?
  public let last_used: Double?
  public let current: Bool
}

public struct TwoFactorStatus: Codable, Sendable, Equatable { public let enabled: Bool }

/// An upload job: a file the server recognises and translates in one pass (cloud re-subtitling).
public struct Job: Codable, Sendable, Equatable, Identifiable {
  public let id: String
  public let status: String // uploading → queued → extracting → recognizing → segmenting → translating → rendering → done | failed
  public let progress: Double?
  public let error: String?
  public let files: [String]?
  public var isDone: Bool { status == "done" }
  public var isFailed: Bool { status == "failed" }
}

public struct JobLanguages: Codable, Sendable { public let sources: [String: String]; public let targets: [String: String] }

/// What comes back while a summary is being written (server/lib/summaries.js).
public enum SummaryEvent: Sendable, Equatable {
  case stage(String) // asking · thinking · writing · condensing
  case delta(String)
  case done(markdown: String)
}

/// What a joined talk sends (server/lib/live.js).
public enum JoinEvent: Sendable, Equatable {
  case started(name: String, lines: [JoinedLine], live: Bool)
  case line(JoinedLine)
  case cleared
  case status(live: Bool, viewers: Int)
}

/// A line of someone else's talk, as their Mac mirrors it.
public struct JoinedLine: Codable, Sendable, Equatable {
  public let id: String
  public let sourceText: String?
  public let targetText: String?
  public let ended: Bool?
  public let wallStart: Double?
  public let wallEnd: Double?

  enum CodingKeys: String, CodingKey { case id, sourceText, targetText, ended, wallStart, wallEnd }
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    // the Mac's line ids are strings ("voice:3"); be generous about a number all the same
    id = (try? c.decode(String.self, forKey: .id)) ?? String((try? c.decode(Int.self, forKey: .id)) ?? 0)
    sourceText = try c.decodeIfPresent(String.self, forKey: .sourceText)
    targetText = try c.decodeIfPresent(String.self, forKey: .targetText)
    ended = try c.decodeIfPresent(Bool.self, forKey: .ended)
    wallStart = try c.decodeIfPresent(Double.self, forKey: .wallStart)
    wallEnd = try c.decodeIfPresent(Double.self, forKey: .wallEnd)
  }

  public var asResult: LiveResult {
    LiveResult(sentenceId: id, sourceText: sourceText, targetText: targetText, wallStart: wallStart, wallEnd: wallEnd, sentenceEnd: ended ?? false)
  }
}
