import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// The account first, then what shapes a talk, then the app. There is no login form here: the account is the
/// door, and a logged-out app never gets this far.
struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  @State private var loggingOut = false

  var body: some View {
    @Bindable var prefs = prefs
    NavigationStack {
      List {
        Section { account }.listRowBackground(Color.mqSurface)
        if app.isSignedIn {
          Section {
            NavigationLink { DevicesView() } label: { Text(L("ios.settings.devices")) }
            NavigationLink { PasswordView() } label: { Text(L("ios.settings.password")) }
            LabeledContent(L("ios.settings.twoFactor")) { TwoFactorValue() }
          } footer: { Text(L("ios.settings.twoFactorHint")) }.listRowBackground(Color.mqSurface)
        }
        Section(L("ios.settings.talks")) {
          NavigationLink { LanguageLists().navigationTitle(L("ios.lang.title")).background(Color.mqBackground) } label: {
            LabeledContent(L("ios.lang.title")) { Text("\(LiveSchema.shared.name(of: prefs.source).native) → \(LiveSchema.shared.name(of: prefs.target).native)") }
          }
          if app.isSignedIn { NavigationLink { GlossaryView() } label: { LabeledContent(L("ios.glossary.title")) { Text(L("ios.glossary.count", ["n": String(app.glossary.items.count)])) } } }
          NavigationLink { RecognitionView() } label: { Text(L("ios.settings.recognition")) }
          NavigationLink { TextSheet().navigationTitle(L("ios.text.title")) } label: { Text(L("ios.text.title")) }
          NavigationLink { RecordingSettingsView() } label: { LabeledContent(L("ios.settings.recording")) { Text("\(prefs.bitRate / 1000) kb/s") } }
        }.listRowBackground(Color.mqSurface)
        Section(L("ios.settings.app")) {
          Picker(L("ios.settings.language"), selection: $prefs.language) { Text(L("ios.settings.system")).tag("system"); Text("English").tag("en"); Text("简体中文").tag("zh-Hans") }
          Picker(L("ios.settings.appearance"), selection: $prefs.appearance) { Text(L("ios.settings.system")).tag("system"); Text(L("ios.settings.dark")).tag("dark"); Text(L("ios.settings.light")).tag("light") }
          Toggle(isOn: $prefs.demo) { VStack(alignment: .leading) { Text(L("ios.settings.demo")); Text(L("ios.settings.demoHint")).font(.mqHint).foregroundStyle(Color.mqText3) } }
            .tint(Color.mqOk) // green is what a switch says when it is on; it is not the app's accent
            .disabled(app.live.map { !$0.isOver } ?? false)
          LabeledContent(L("ios.settings.version")) { Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "") }
          Link(L("ios.settings.website"), destination: URL(string: "https://seesubtitles.com")!)
        }.listRowBackground(Color.mqSurface)
        if app.isSignedIn { Section { Button(L("ios.settings.logout"), role: .destructive) { loggingOut = true } }.listRowBackground(Color.mqSurface) }
      }
      .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Color.mqBackground)
      .navigationTitle(L("ios.tab.settings"))
      .task { await app.refreshAccount() }
      .confirmationDialog(L("ios.settings.logoutAsk"), isPresented: $loggingOut, titleVisibility: .visible) {
        Button(L("ios.settings.logout"), role: .destructive) { Task { await app.logout() } }
      } message: { Text(L("ios.settings.logoutBody")) }
    }
  }

  @ViewBuilder private var account: some View {
    if let account = app.account {
      let plan = account.plan
      VStack(alignment: .leading, spacing: 12) {
        StackRow(account.user.email, [plan.name, plan.limits.talks.map { L("ios.settings.talksAtOnce", ["n": String($0)]) }, plan.team?.name].compactMap { $0 }.joined(separator: " · "))
        HStack(spacing: 10) {
          UsageTile(title: L("ios.usage.live"), used: plan.used.liveSeconds, limit: plan.limits.liveSeconds)
          UsageTile(title: L("ios.usage.files"), used: plan.used.fileSeconds, limit: plan.limits.fileSeconds)
        }
        NavigationLink { UsageBreakdownView() } label: { Text(L("ios.usage.details")) }
      }.padding(.vertical, 4)
    } else if prefs.demo {
      StackRow(L("ios.demo.badge"), L("ios.settings.demoHint"))
    } else {
      StackRow(L("ios.settings.account"), L("ios.err.offline"))
    }
  }
}

/// This month's hours: the server's count, shown the way the Mac's tiles show it.
struct UsageTile: View {
  let title: String; let used: Double; let limit: Double?
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.mqHint).foregroundStyle(Color.mqText3)
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text(hoursMinutes(used)).font(.title3.weight(.semibold).monospacedDigit()).foregroundStyle(Color.mqText)
        Text(limit.map { "/ \(Int($0 / 3600)) h" } ?? L("ios.usage.unlimited")).font(.mqHint).foregroundStyle(Color.mqText3)
      }
      if let limit, limit > 0 { ProgressView(value: min(1, used / limit)).tint(used >= limit ? Color.mqBad : Color.mqAccent) }
    }
    .padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.mqSurface2, in: RoundedRectangle(cornerRadius: 12))
    .accessibilityElement(children: .combine)
  }
}

/// The same account and mode/model breakdown as the website, read from the server's ledger.
struct UsageBreakdownView: View {
  @Environment(AppModel.self) private var app
  @State private var month = Self.monthString(Date())
  @State private var accounts: [User] = []
  @State private var selectedAccount = 0
  @State private var rows: [UsageDetailRow] = []
  @State private var problem: String?
  @State private var loading = false

  private var isAdmin: Bool { app.account?.user.role == "admin" }

  var body: some View {
    List {
      Section {
        HStack {
          Button { shiftMonth(-1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel(L("ios.usage.previous"))
          Spacer()
          Text(month).font(.headline.monospacedDigit())
          Spacer()
          Button { shiftMonth(1) } label: { Image(systemName: "chevron.right") }.accessibilityLabel(L("ios.usage.next"))
            .disabled(month >= Self.monthString(Date()))
        }.buttonStyle(.plain)
        if isAdmin && !accounts.isEmpty {
          Picker(L("ios.usage.account"), selection: $selectedAccount) {
            ForEach(accounts, id: \.id) { user in Text(user.email).tag(user.id) }
          }
        }
      }.listRowBackground(Color.mqSurface)
      Section {
        if loading { ProgressView() }
        else if let problem { Text(problem).foregroundStyle(Color.mqBad) }
        else if rows.isEmpty { Text(L("ios.usage.empty")).foregroundStyle(Color.mqText3) }
        else {
          ForEach(rows) { row in
            VStack(alignment: .leading, spacing: 5) {
              Text("\(provider(row.provider)) · \(row.model)").font(.mqSecondary.weight(.semibold))
              Text("\(mode(row.pipeline)) · \(operation(row.operation))" + (row.source.isEmpty && row.target.isEmpty ? "" : " · \(row.source) → \(row.target)"))
                .font(.mqHint).foregroundStyle(Color.mqText3)
              HStack(spacing: 10) {
                if row.seconds > 0 { Text(row.seconds < 60 ? L("ios.usage.seconds", ["n": String(Int(row.seconds.rounded()))]) : L("ios.usage.duration", ["time": hoursMinutes(row.seconds)])) }
                if row.calls > 0 { Text(L("ios.usage.calls", ["n": String(row.calls)])) }
                if row.inputTokens > 0 || row.outputTokens > 0 {
                  Text(L("ios.usage.tokens", ["input": String(row.inputTokens), "output": String(row.outputTokens)]))
                }
              }.font(.mqHint.monospacedDigit()).foregroundStyle(Color.mqText2)
            }.padding(.vertical, 4).accessibilityElement(children: .combine)
          }
        }
      } footer: { Text(L("ios.usage.note")) }.listRowBackground(Color.mqSurface)
    }
    .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Color.mqBackground)
    .navigationTitle(L("ios.usage.details"))
    .task {
      if isAdmin {
        accounts = (try? await app.api.usageAccounts()) ?? []
        selectedAccount = app.account?.user.id ?? 0
      }
    }
    .task(id: "\(month):\(selectedAccount)") { await load() }
  }

  private func load() async {
    guard app.isSignedIn && (!isAdmin || selectedAccount > 0) else { return }
    loading = true
    defer { loading = false }
    do {
      let result = try await app.api.usageDetail(month: month, userId: isAdmin ? selectedAccount : nil)
      rows = result.rows; problem = nil
    } catch { problem = L("ios.err.offline") }
  }

  private func shiftMonth(_ offset: Int) {
    let parts = month.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 2 else { return }
    var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: 1)),
          let shifted = calendar.date(byAdding: .month, value: offset, to: date) else { return }
    month = Self.monthString(shifted)
  }

  private static func monthString(_ date: Date) -> String {
    let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.timeZone = TimeZone(secondsFromGMT: 0)
    f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM"
    return f.string(from: date)
  }

  private func provider(_ id: String) -> String {
    switch id {
    case "tencent": L("ios.usage.tencent")
    case "alibaba": L("ios.usage.alibaba")
    case "tokenhub": L("ios.usage.tokenhub")
    default: id
    }
  }
  private func mode(_ id: String) -> String {
    switch id {
    case "split": L("ios.usage.split")
    case "combined": L("ios.usage.combined")
    case "mixed": L("ios.usage.mixed")
    case "file": L("ios.usage.fileMode")
    case "summary": L("ios.usage.summaryMode")
    default: id
    }
  }
  private func operation(_ id: String) -> String {
    switch id {
    case "recognition": L("ios.usage.recognition")
    case "combined": L("ios.usage.combinedOperation")
    case "translation": L("ios.usage.translation")
    case "summary": L("ios.usage.summaryOperation")
    default: id
    }
  }
}

struct TwoFactorValue: View {
  @Environment(AppModel.self) private var app
  @State private var enabled: Bool?
  var body: some View {
    Text(enabled.map { $0 ? L("common.on") : L("common.off") } ?? "…").task { enabled = try? await app.api.twoFactor().enabled }
  }
}

struct DevicesView: View {
  @Environment(AppModel.self) private var app
  @State private var devices: [Device] = []
  @State private var problem: String?

  var body: some View {
    List {
      Section {
        ForEach(devices) { d in
          StackRow(d.label, d.current ? L("ios.devices.this") : lastUsed(d)) {
            if !d.current { Button(L("ios.devices.signOut")) { Task { try? await app.api.signOut(device: d.id); await load() } }.font(.mqSecondary).buttonStyle(.borderless) }
          }
        }
      } footer: { if let problem { Text(problem) } }.listRowBackground(Color.mqSurface)
      if devices.count > 1 { Section { Button(L("ios.devices.signOutAll"), role: .destructive) { Task { try? await app.api.signOutEverywhereElse(); await load() } } }.listRowBackground(Color.mqSurface) }
    }
    .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Color.mqBackground)
    .navigationTitle(L("ios.settings.devices")).task { await load() }
  }

  private func load() async { do { devices = try await app.api.devices(); problem = nil } catch { problem = L("ios.err.offline") } }
  private func lastUsed(_ d: Device) -> String {
    guard let t = d.last_used else { return "" }
    return RecordingFormat.day(Date(timeIntervalSince1970: t / 1000))
  }
}

struct PasswordView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var current = ""
  @State private var next = ""
  @State private var problem: String?
  @State private var busy = false

  var body: some View {
    Form {
      Section {
        SecureField(L("ios.password.current"), text: $current).textContentType(.password)
        SecureField(L("ios.password.new"), text: $next).textContentType(.newPassword)
      } footer: { Text(problem ?? L("ios.password.hint")).foregroundStyle(problem == nil ? Color.mqText3 : Color.mqBad) }.listRowBackground(Color.mqSurface)
      Section { Button(L("ios.save")) { save() }.disabled(busy || current.isEmpty || next.count < 8) }.listRowBackground(Color.mqSurface)
    }
    .scrollContentBackground(.hidden).background(Color.mqBackground).navigationTitle(L("ios.settings.password"))
  }

  private func save() {
    busy = true
    Task {
      defer { busy = false }
      do { try await app.api.changePassword(current: current, next: next); dismiss() }
      catch let e as APIError { problem = e.status == 400 ? L("ios.password.wrong") : L("ios.err.server") }
      catch { problem = L("ios.err.offline") }
    }
  }
}

struct RecognitionView: View {
  @Environment(Preferences.self) private var prefs
  var body: some View {
    @Bindable var prefs = prefs
    let schema = LiveSchema.shared
    Form {
      Section {
        Picker(L("ios.recog.model"), selection: $prefs.transModel) { ForEach(schema.models[schema.defaultPipeline] ?? []) { Text($0.label).tag($0.id) } }
      }.listRowBackground(Color.mqSurface)
      Section {
        slider(L("ios.recog.pause"), value: Binding(get: { Double(prefs.vadSilenceTime) }, set: { prefs.vadSilenceTime = Int($0) }), range: schema.tuning.vadSilenceTime, unit: "ms")
        slider(L("ios.recog.split"), value: Binding(get: { Double(prefs.maxSpeakTime) }, set: { prefs.maxSpeakTime = Int($0) }), range: schema.tuning.maxSpeakTime, unit: "s")
        slider(L("ios.recog.noise"), value: $prefs.noiseThreshold, range: schema.tuning.noiseThreshold, unit: "")
        Picker(L("ios.recog.filler"), selection: $prefs.filterModal) { Text(L("ios.recog.fillerKeep")).tag("0"); Text(L("ios.recog.fillerSome")).tag("1"); Text(L("ios.recog.fillerStrict")).tag("2") }
      } footer: { Text(L("ios.recog.hint")) }.listRowBackground(Color.mqSurface)
    }
    .scrollContentBackground(.hidden).background(Color.mqBackground).navigationTitle(L("ios.settings.recognition"))
  }

  private func slider(_ title: String, value: Binding<Double>, range: LiveSchema.Range, unit: String) -> some View {
    VStack(alignment: .leading) {
      HStack { Text(title); Spacer(); Text("\(String(format: "%g", value.wrappedValue)) \(unit)").font(.mqMono).foregroundStyle(Color.mqText3) }
      Slider(value: value, in: range.min...range.max, step: range.step).tint(Color.mqAccent)
    }
  }
}

struct RecordingSettingsView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  var body: some View {
    @Bindable var prefs = prefs
    Form {
      Section {
        Toggle(L("ios.recset.onStart"), isOn: $prefs.recordOnStart).tint(Color.mqOk)
        Picker(L("ios.recset.quality"), selection: $prefs.bitRate) { Text("64 kb/s").tag(64_000); Text("96 kb/s").tag(96_000); Text("128 kb/s").tag(128_000) }
      } footer: { Text(L("ios.recset.hint")) }.listRowBackground(Color.mqSurface)
      Section("MP4") {
        Toggle(L("ios.recset.autoMP4"), isOn: $prefs.autoMP4).tint(Color.mqOk)
        Picker(L("ios.recset.shape"), selection: $prefs.mp4Landscape) { Text(L("ios.recset.portrait")).tag(false); Text(L("ios.recset.landscape")).tag(true) }
      }.listRowBackground(Color.mqSurface)
      Section {
        LabeledContent(L("ios.recset.used")) { Text(ByteCountFormatter.string(fromByteCount: Int64(app.recordings.reduce(0) { $0 + $1.bytes }), countStyle: .file)) }
      } header: { Text(L("ios.recset.storage")) } footer: { Text(L("ios.recset.storageHint")) }.listRowBackground(Color.mqSurface)
    }
    .scrollContentBackground(.hidden).background(Color.mqBackground).navigationTitle(L("ios.settings.recording"))
  }
}

/// The account's glossary: names and terms the recogniser should prefer. Shared with the Mac and the web.
struct GlossaryView: View {
  @Environment(AppModel.self) private var app
  @State private var items: [GlossaryItem] = []
  @State private var adding = false
  @State private var term = ""
  @State private var weight = 8.0
  @State private var note = ""
  @State private var problem: String?
  @State private var query = ""

  var body: some View {
    let shown = query.isEmpty ? items : items.filter { $0.term.localizedCaseInsensitiveContains(query) || ($0.note ?? "").localizedCaseInsensitiveContains(query) }
    List {
      Section {
        ForEach(shown) { item in
          StackRow(item.term, item.note ?? "") { Text(item.weight >= 100 ? L("ios.glossary.always") : String(item.weight)).font(.mqMono).foregroundStyle(Color.mqText3) }
        }
        .onDelete { offsets in let ids = offsets.map { shown[$0].id }; items.removeAll { ids.contains($0.id) }; save() }
      } footer: { Text(problem ?? L("ios.glossary.hint")).foregroundStyle(problem == nil ? Color.mqText3 : Color.mqBad) }.listRowBackground(Color.mqSurface)
    }
    .listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Color.mqBackground)
    .searchable(text: $query, prompt: L("ios.glossary.count", ["n": String(items.count)]))
    .navigationTitle(L("ios.glossary.title"))
    .toolbar { Button { term = ""; note = ""; weight = 8; adding = true } label: { Image(systemName: "plus") }.accessibilityLabel(L("ios.glossary.add")) }
    .onAppear { items = app.glossary.items }
    .sheet(isPresented: $adding) {
      NavigationStack {
        Form {
          Section { TextField(L("ios.glossary.term"), text: $term); TextField(L("ios.glossary.note"), text: $note) }.listRowBackground(Color.mqSurface)
          Section {
            VStack(alignment: .leading) { HStack { Text(L("ios.glossary.weight")); Spacer(); Text(weight >= 12 ? L("ios.glossary.always") : String(Int(weight))).font(.mqMono) }; Slider(value: $weight, in: 1...12, step: 1).tint(Color.mqAccent) }
          } footer: { Text(L("ios.glossary.weightHint")) }.listRowBackground(Color.mqSurface)
        }
        .scrollContentBackground(.hidden).background(Color.mqBackground)
        .navigationTitle(L("ios.glossary.add")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button(L("ios.cancel")) { adding = false } }
          ToolbarItem(placement: .confirmationAction) { Button(L("ios.save")) { add() }.disabled(term.trimmingCharacters(in: .whitespaces).isEmpty) }
        }
      }.presentationDetents([.medium])
    }
  }

  private func add() {
    let clean = term.trimmingCharacters(in: .whitespaces)
    items.removeAll { $0.id == clean.lowercased() }
    items.insert(GlossaryItem(term: clean, weight: weight >= 12 ? 100 : Int(weight), note: note.isEmpty ? nil : note), at: 0)
    adding = false
    save()
  }

  private func save() {
    Task { do { try await app.save(glossary: items); items = app.glossary.items; problem = nil } catch let e as APIError { problem = e.message } catch { problem = L("ios.err.offline") } }
  }
}
