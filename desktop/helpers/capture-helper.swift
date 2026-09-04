// Native microphone capture for macOS: AVAudioEngine → 48 kHz mono s16le on stdout.
// Replaces ffmpeg's AVFoundation input, which drops ~10% of audio frames in audio-only capture.
//
//   capture-helper [--device "Name or UID"] [--rate 48000]     stream PCM to stdout
//   capture-helper --list                                        JSON list of input devices
//
// Exits with code 3 when the audio configuration changes (device unplugged, default input changed)
// so the supervisor (lib/capture.js) can restart it.
import AVFoundation
import CoreAudio
import Foundation

let args = CommandLine.arguments
func arg(_ name: String) -> String? {
  if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }
  return nil
}
func log(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

struct Dev { let id: AudioDeviceID; let name: String; let uid: String; let inputs: Int }

func stringProperty(_ id: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String {
  var addr = AudioObjectPropertyAddress(mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var value: Unmanaged<CFString>? = nil
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, &value) == noErr, let v = value else { return "" }
  return v.takeRetainedValue() as String
}

func inputChannels(_ id: AudioDeviceID) -> Int {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreamConfiguration, mScope: kAudioObjectPropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(id, &addr, 0, nil, &size) == noErr, size > 0 else { return 0 }
  let raw = UnsafeMutableRawPointer.allocate(byteCount: Int(size), alignment: MemoryLayout<AudioBufferList>.alignment)
  defer { raw.deallocate() }
  guard AudioObjectGetPropertyData(id, &addr, 0, nil, &size, raw) == noErr else { return 0 }
  let list = UnsafeMutableAudioBufferListPointer(raw.assumingMemoryBound(to: AudioBufferList.self))
  return list.reduce(0) { $0 + Int($1.mNumberChannels) }
}

func allInputDevices() -> [Dev] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  let sys = AudioObjectID(kAudioObjectSystemObject)
  guard AudioObjectGetPropertyDataSize(sys, &addr, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioDeviceID](repeating: 0, count: Int(size) / MemoryLayout<AudioDeviceID>.size)
  guard AudioObjectGetPropertyData(sys, &addr, 0, nil, &size, &ids) == noErr else { return [] }
  return ids.compactMap { id in
    let inputs = inputChannels(id)
    if inputs == 0 { return nil }
    return Dev(id: id, name: stringProperty(id, kAudioObjectPropertyName), uid: stringProperty(id, kAudioDevicePropertyDeviceUID), inputs: inputs)
  }
}

func defaultInputDevice() -> AudioDeviceID {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var id = AudioDeviceID(0)
  var size = UInt32(MemoryLayout<AudioDeviceID>.size)
  _ = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &id)
  return id
}

func jsonString(_ s: String) -> String {
  let escaped = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
  return "\"\(escaped)\""
}

if args.contains("--list") {
  let def = defaultInputDevice()
  let items = allInputDevices().map {
    "{\"id\":\($0.id),\"name\":\(jsonString($0.name)),\"uid\":\(jsonString($0.uid)),\"inputs\":\($0.inputs),\"default\":\($0.id == def)}"
  }
  print("[" + items.joined(separator: ",") + "]")
  exit(0)
}

let deviceSel = arg("--device") ?? "default"
let outRate = Double(arg("--rate") ?? "48000") ?? 48000
let engine = AVAudioEngine()
let input = engine.inputNode
var deviceName = "system default input"

if deviceSel != "default" && !deviceSel.isEmpty {
  let devs = allInputDevices()
  let match = devs.first { $0.name == deviceSel || $0.uid == deviceSel || String($0.id) == deviceSel }
    ?? devs.first { $0.name.localizedCaseInsensitiveContains(deviceSel) }
  if let d = match, let unit = input.audioUnit {
    var devId = d.id
    let st = AudioUnitSetProperty(unit, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &devId, UInt32(MemoryLayout<AudioDeviceID>.size))
    if st == noErr { deviceName = d.name } else { log("could not select \"\(d.name)\" (OSStatus \(st)); using the default input") }
  } else {
    log("input device \"\(deviceSel)\" not found; using the default input")
  }
}

let inFormat = input.inputFormat(forBus: 0)
guard inFormat.sampleRate > 0, inFormat.channelCount > 0 else {
  log("no usable input format — is microphone access allowed for this app, and is a device connected?")
  exit(2)
}
let channels = Int(inFormat.channelCount)
guard let floatFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: outRate, channels: inFormat.channelCount, interleaved: false),
      let converter = AVAudioConverter(from: inFormat, to: floatFormat) else {
  log("cannot build a converter from \(inFormat)")
  exit(2)
}
log("capturing \(deviceName): \(Int(inFormat.sampleRate)) Hz, \(channels) ch → \(Int(outRate)) Hz mono s16le")

signal(SIGPIPE, SIG_IGN)
let writer = DispatchQueue(label: "capture.stdout")
func emit(_ data: Data) {
  writer.async {
    data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
      var offset = 0
      while offset < raw.count {
        let n = Darwin.write(1, raw.baseAddress! + offset, raw.count - offset)
        if n <= 0 { exit(0) } // parent went away
        offset += n
      }
    }
  }
}

input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { buffer, _ in
  let capacity = AVAudioFrameCount(Double(buffer.frameLength) * outRate / inFormat.sampleRate) + 64
  guard let out = AVAudioPCMBuffer(pcmFormat: floatFormat, frameCapacity: capacity) else { return }
  var supplied = false
  var error: NSError? = nil
  let status = converter.convert(to: out, error: &error) { _, outStatus in
    if supplied { outStatus.pointee = .noDataNow; return nil }
    supplied = true
    outStatus.pointee = .haveData
    return buffer
  }
  if status == .error { log("convert error: \(error?.localizedDescription ?? "unknown")"); return }
  let n = Int(out.frameLength)
  if n == 0 { return }
  guard let chans = out.floatChannelData else { return }
  var pcm = [Int16](repeating: 0, count: n)
  let scale = Float(32767) / Float(channels)
  for i in 0..<n {
    var s: Float = 0
    for c in 0..<channels { s += chans[c][i] }
    let v = s * scale
    pcm[i] = Int16(max(-32768, min(32767, v)))
  }
  emit(pcm.withUnsafeBufferPointer { Data(buffer: $0) })
}

do {
  try engine.start()
} catch {
  log("engine start failed: \(error.localizedDescription)")
  exit(2)
}
let startedAt = Date()
// Selecting a device fires one configuration-change notification right after start; ignore that one.
NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { _ in
  if Date().timeIntervalSince(startedAt) < 2 { return }
  log("audio configuration changed (device change); exiting for restart")
  exit(3)
}
RunLoop.main.run()
