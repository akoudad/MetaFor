import AppKit

func writeIcon(size: Int, tray: Bool, path: String) throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    let s = CGFloat(size)
    if !tray {
        let rect = NSBezierPath(roundedRect: NSRect(x: s * 0.035, y: s * 0.035, width: s * 0.93, height: s * 0.93), xRadius: s * 0.21, yRadius: s * 0.21)
        NSColor(calibratedRed: 0.045, green: 0.045, blue: 0.06, alpha: 1).setFill(); rect.fill()
        NSColor(white: 0.22, alpha: 1).setStroke(); rect.lineWidth = s * 0.003; rect.stroke()
        let glow = NSGradient(starting: NSColor(calibratedRed: 0.45, green: 0.48, blue: 0.63, alpha: 0.55), ending: NSColor(white: 0, alpha: 0))!
        glow.draw(in: NSBezierPath(ovalIn: NSRect(x: s * 0.14, y: s * 0.14, width: s * 0.72, height: s * 0.72)), relativeCenterPosition: .zero)
    }
    let star = NSBezierPath()
    let points: [(CGFloat, CGFloat)] = [(0.5,0.79),(0.55,0.55),(0.79,0.5),(0.55,0.45),(0.5,0.21),(0.45,0.45),(0.21,0.5),(0.45,0.55)]
    for (i, point) in points.enumerated() {
        let p = NSPoint(x: point.0 * s, y: point.1 * s)
        if i == 0 { star.move(to: p) } else { star.line(to: p) }
    }
    star.close(); (tray ? NSColor.black : NSColor(calibratedRed: 0.88, green: 0.9, blue: 0.95, alpha: 1)).setFill(); star.fill()
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
}
try writeIcon(size: 1024, tray: false, path: "desktop/assets/icon.png")
try writeIcon(size: 36, tray: true, path: "desktop/assets/tray.png")
