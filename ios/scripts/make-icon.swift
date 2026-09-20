// The iOS app icon from the mark's geometry (design/canvas/icons.mjs `stack`): full-bleed, because iOS cuts the
// corners itself.   swift ios/scripts/make-icon.swift ios/App/Assets.xcassets/AppIcon.appiconset/icon-1024.png
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let out = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon-1024.png")
let size = 1024
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
func color(_ hex: UInt32) -> CGColor { CGColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: 1) }
ctx.setFillColor(color(0x131210)); ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))
// the mark lives in an 824 tile; on iOS the tile is the whole icon, so scale it up and flip y (CoreGraphics counts from the bottom)
let u = CGFloat(size) / 824
func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect { CGRect(x: x * u, y: CGFloat(size) - (y + h) * u, width: w * u, height: h * u) }
func pill(_ r: CGRect, _ hex: UInt32) { ctx.setFillColor(color(hex)); ctx.addPath(CGPath(roundedRect: r, cornerWidth: r.height / 2, cornerHeight: r.height / 2, transform: nil)); ctx.fillPath() }
ctx.setFillColor(color(0xff453a)); ctx.fillEllipse(in: rect(150, 150, 92, 92))
pill(rect(150, 452, 524, 96), 0xf1ece2)
pill(rect(232, 596, 360, 72), 0xf5c518)
let dest = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(out.path)") }
print("wrote", out.path)
