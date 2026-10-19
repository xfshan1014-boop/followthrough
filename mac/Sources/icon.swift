// Draws the Followthrough app icon (same design as assets/icon.svg) into an .iconset folder.
// Usage: swift icon.swift <output.iconset>
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1])
try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

func draw(_ px: Int) -> Data {
    let s = CGFloat(px), k = s / 512
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
                               hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    // macOS icon grid: artwork inset to ~80% of the canvas
    let inset = s * 0.1, box = NSRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2), b = box.width / 512
    NSColor(srgbRed: 0.11, green: 0.106, blue: 0.098, alpha: 1).setFill()
    NSBezierPath(roundedRect: box, xRadius: 112 * b, yRadius: 112 * b).fill()
    let light = NSColor(srgbRed: 0.965, green: 0.965, blue: 0.953, alpha: 1)
    // icon B "Thread": one line that loops once and lands on a dot (same path as assets/icon.svg)
    func pt(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: box.minX + x * b, y: box.maxY - y * b) }
    let line = NSBezierPath()
    line.move(to: pt(118, 330))
    line.curve(to: pt(270, 170), controlPoint1: pt(170, 330), controlPoint2: pt(190, 170))
    line.curve(to: pt(280, 270), controlPoint1: pt(345, 170), controlPoint2: pt(345, 270))
    line.curve(to: pt(360, 340), controlPoint1: pt(220, 270), controlPoint2: pt(230, 340))
    line.lineWidth = 40 * b; line.lineCapStyle = .round
    light.setStroke(); line.stroke()
    NSColor(srgbRed: 0.902, green: 0.553, blue: 0.4, alpha: 1).setFill()
    NSBezierPath(ovalIn: NSRect(x: box.minX + (376 - 38) * b, y: box.maxY - (340 + 38) * b, width: 76 * b, height: 76 * b)).fill()
    _ = k
    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}
for (name, px) in [("16x16", 16), ("16x16@2x", 32), ("32x32", 32), ("32x32@2x", 64), ("128x128", 128), ("128x128@2x", 256),
                   ("256x256", 256), ("256x256@2x", 512), ("512x512", 512), ("512x512@2x", 1024)] {
    try! draw(px).write(to: out.appendingPathComponent("icon_\(name).png"))
}
