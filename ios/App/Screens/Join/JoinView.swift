import AVFoundation
import SubtitlesCore
import SubtitlesDesign
import SwiftUI

/// Join a talk: point the camera at the code on the screen, or type it. Needs no account.
struct JoinView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var typed = ""
  @State private var problem: String?

  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        ZStack {
          CodeScanner { found in if let code = APIClient.shareCode(from: found) { join(code) } }
          RoundedRectangle(cornerRadius: 26).stroke(Color.mqAccent, lineWidth: 3).frame(width: 230, height: 230)
          VStack { Spacer(); Text(L("ios.join.point")).font(.mqSecondary).foregroundStyle(.white.opacity(0.85)).padding(.bottom, 24) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.black)
        VStack(spacing: 10) {
          HStack {
            TextField(L("ios.join.typeCode"), text: $typed).textInputAutocapitalization(.never).autocorrectionDisabled().font(.body.monospaced()).submitLabel(.go).onSubmit(submit)
              .modifier(FieldStyle(focused: false))
            Button(L("ios.join.go"), action: submit).buttonStyle(SecondaryButtonStyle(fill: false)).disabled(APIClient.shareCode(from: typed) == nil)
          }
          if let problem { StatusLabel(.bad, problem) } else { Text(L("ios.join.noAccount")).font(.mqHint).foregroundStyle(Color.mqText3) }
        }.padding(.horizontal, 20).padding(.vertical, 16)
      }
      .background(Color.mqBackground)
      .navigationTitle(L("ios.join.title")).navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("ios.cancel")) { dismiss() } } }
    }
  }

  private func submit() { if let code = APIClient.shareCode(from: typed) { join(code) } else { problem = L("ios.join.badCode") } }
  private func join(_ code: String) { dismiss(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { app.joinCode = code } }
}

/// The camera, looking for a QR code. On a device without one (the simulator) it is simply black, and the code is typed.
struct CodeScanner: UIViewRepresentable {
  var found: (String) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(found: found) }
  func makeUIView(context: Context) -> PreviewView {
    let view = PreviewView()
    context.coordinator.start(in: view)
    return view
  }
  func updateUIView(_ view: PreviewView, context: Context) {}
  static func dismantleUIView(_ view: PreviewView, coordinator: Coordinator) { coordinator.stop() }

  final class PreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
  }

  final class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate, @unchecked Sendable {
    private let session = AVCaptureSession()
    private let found: (String) -> Void
    private var done = false
    init(found: @escaping (String) -> Void) { self.found = found }

    @MainActor func start(in view: PreviewView) {
      guard let camera = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input) else { return }
      session.addInput(input)
      let output = AVCaptureMetadataOutput()
      guard session.canAddOutput(output) else { return }
      session.addOutput(output)
      output.setMetadataObjectsDelegate(self, queue: .main)
      output.metadataObjectTypes = [.qr]
      view.preview.session = session
      view.preview.videoGravity = .resizeAspectFill
      let session = self.session
      DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    func stop() { let session = self.session; DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() } }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
      guard !done, let text = (objects.first as? AVMetadataMachineReadableCodeObject)?.stringValue, APIClient.shareCode(from: text) != nil else { return }
      done = true
      found(text)
    }
  }
}
