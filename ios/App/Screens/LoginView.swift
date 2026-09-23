import AuthenticationServices
import SubtitlesCore
import SubtitlesDesign
import SwiftUI

struct LoginView: View {
  @Environment(AppModel.self) private var app
  @Environment(Preferences.self) private var prefs
  @State private var email = ""
  @State private var password = ""
  @State private var code = ""
  @State private var needsCode = false
  @State private var busy = false
  @State private var problem: String?
  @State private var joining = false
  @State private var appleEnabled = false
  @State private var appleNonce = ""
  @FocusState private var focus: Field?
  enum Field { case email, password, code }

  var body: some View {
    VStack(spacing: 0) {
      Spacer()
      VStack(alignment: .leading, spacing: Spacing.s4) {
        HStack(spacing: Spacing.s3) {
          MarkView(size: 44)
          Text(L("brand")).font(.mqDisplay(.largeTitle)).foregroundStyle(Color.mqText)
        }
        .padding(.bottom, Spacing.s2)
        Text(needsCode ? L("ios.login.codeTitle") : L("ios.login.title")).font(.title2.weight(.semibold)).foregroundStyle(Color.mqText)

        if needsCode {
          Text(L("err.totp_required")).font(.mqSecondary).foregroundStyle(Color.mqText2)
          field(L("ios.login.code"), text: $code, .code).keyboardType(.numberPad).textContentType(.oneTimeCode)
        } else {
          field(L("ios.login.email"), text: $email, .email).keyboardType(.emailAddress).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
          SecureField(L("ios.login.password"), text: $password).textContentType(.password).focused($focus, equals: .password)
            .modifier(FieldStyle(focused: focus == .password)).onSubmit(submit)
        }
        if let problem { StatusLabel(.bad, problem) }
        Button(action: submit) { if busy { ProgressView().tint(Color.mqOnAccent) } else { Text(L("ios.login.submit")) } }
          .buttonStyle(PrimaryButtonStyle()).disabled(busy || (needsCode ? code.count < 6 : email.isEmpty || password.isEmpty))
        if appleEnabled && !needsCode {
          SignInWithAppleButton(.signIn, onRequest: { request in
            appleNonce = UUID().uuidString
            request.nonce = appleNonce
            request.requestedScopes = [.email]
          }, onCompletion: { result in
            switch result {
            case .success(let authorization):
              guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                    let data = credential.authorizationCode,
                    let code = String(data: data, encoding: .utf8) else { problem = L("ios.login.appleFailed"); return }
              busy = true; problem = nil
              Task {
                defer { busy = false }
                do { try await app.loginApple(code: code, nonce: appleNonce) }
                catch let error as APIError where error.code == "apple_unknown" { problem = L("ios.login.appleUnknown") }
                catch { problem = L("ios.login.appleFailed") }
              }
            case .failure: problem = L("ios.login.appleFailed")
            }
          })
          .signInWithAppleButtonStyle(.black)
          .frame(height: 50)
          .disabled(busy)
        }
        if needsCode { Button(L("ios.login.back")) { needsCode = false; code = ""; problem = nil }.frame(maxWidth: .infinity) }
        Text(L("ios.login.hint")).font(.mqHint).foregroundStyle(Color.mqText3).frame(maxWidth: .infinity).multilineTextAlignment(.center)
      }
      .frame(maxWidth: 420)
      .padding(.horizontal, 28)
      Spacer()
      HStack(spacing: Spacing.s5) {
        Button { joining = true } label: { Label(L("ios.join.withCode"), systemImage: "qrcode.viewfinder") }
        Button(L("ios.login.demo")) { prefs.demo = true }
      }
      .font(.mqSecondary.weight(.medium)).padding(.bottom, Spacing.s4)
    }
    .sheet(isPresented: $joining) { JoinView() }
    .task { appleEnabled = (try? await APIClient(server: app.server).publicConfig().apple) ?? false }
  }

  private func field(_ title: String, text: Binding<String>, _ which: Field) -> some View {
    TextField(title, text: text).focused($focus, equals: which).modifier(FieldStyle(focused: focus == which)).onSubmit(submit)
  }

  private func submit() {
    guard !busy else { return }
    busy = true; problem = nil
    Task {
      defer { busy = false }
      do { try await app.login(email: email.trimmingCharacters(in: .whitespaces), password: password, code: needsCode ? code : nil) }
      catch let error as APIError {
        switch error.code {
        case "totp_required": needsCode = true; focus = .code
        case "totp_bad": problem = L("err.totp_bad")
        case "bad_login": problem = L("err.bad_login")
        case "rate_limited": problem = L("err.rate_limited")
        default: problem = L("ios.err.server")
        }
      } catch { problem = L("ios.err.offline") }
    }
  }
}

struct FieldStyle: ViewModifier {
  let focused: Bool
  func body(content: Content) -> some View {
    content.font(.body).padding(.horizontal, 14).frame(minHeight: 50)
      .background(Color.mqSurface, in: RoundedRectangle(cornerRadius: 12))
      .overlay(RoundedRectangle(cornerRadius: 12).stroke(focused ? Color.mqAccent : Color.mqLineStrong))
      .foregroundStyle(Color.mqText)
  }
}
