// Followthrough for Mac: a native window around the same board as the web version.
// Adds what a browser can't: stay on top, menu bar access, open at login,
// Apple's on-device speech recognition, and AI requests sent from the app itself.
import AppKit
import WebKit
import Speech
import AVFoundation
import ServiceManagement
import UniformTypeIdentifiers

let appName = "Followthrough"

// Serves the bundled page from tracker://app/ so storage has a stable origin.
final class BundleScheme: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var rel = url.path.isEmpty || url.path == "/" ? "/index.html" : url.path
        rel = rel.removingPercentEncoding ?? rel
        let file = root.appendingPathComponent(String(rel.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            task.didFailWithError(NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist)); return
        }
        let types = ["html": "text/html; charset=utf-8", "css": "text/css", "js": "text/javascript",
                     "woff2": "font/woff2", "svg": "image/svg+xml", "json": "application/json", "png": "image/png"]
        let mime = types[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": mime, "Cache-Control": "no-cache"])!
        task.didReceive(resp); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

// Live transcription with Apple's recognizer. Prefers on-device; splits lines on pauses.
final class Transcriber {
    var send: (([String: Any]) -> Void)?
    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var silence: Timer?
    private var running = false
    private var lastText = ""

    func start(lang: String, done: @escaping (Bool, [String: Any]) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else { done(false, ["code": "denied", "message": "Speech recognition not allowed"]); return }
                AVCaptureDevice.requestAccess(for: .audio) { granted in
                    DispatchQueue.main.async {
                        guard granted else { done(false, ["code": "denied", "message": "Microphone not allowed"]); return }
                        do { try self.begin(lang: lang); done(true, ["onDevice": self.recognizer?.supportsOnDeviceRecognition ?? false]) }
                        catch { done(false, ["code": "error", "message": error.localizedDescription]) }
                    }
                }
            }
        }
    }
    private func begin(lang: String) throws {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: lang))
        guard let recognizer, recognizer.isAvailable else { throw NSError(domain: appName, code: 1, userInfo: [NSLocalizedDescriptionKey: "Speech recognition isn't available for this language"]) }
        running = true
        newRequest()
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 2048, format: input.outputFormat(forBus: 0)) { [weak self] buf, _ in self?.request?.append(buf) }
        engine.prepare()
        try engine.start()
    }
    private func newRequest() {
        guard running, let recognizer else { return }
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req; lastText = ""
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let result {
                    let text = result.bestTranscription.formattedString
                    if result.isFinal { self.finish(text) } else if text != self.lastText {
                        self.lastText = text
                        self.send?(["type": "partial", "text": text])
                        self.silence?.invalidate()
                        self.silence = Timer.scheduledTimer(withTimeInterval: 1.6, repeats: false) { [weak self] _ in self?.request?.endAudio() }
                    }
                } else if error != nil {
                    self.finish(self.lastText)
                }
            }
        }
    }
    private func finish(_ text: String) {
        silence?.invalidate()
        if !text.trimmingCharacters(in: .whitespaces).isEmpty { send?(["type": "final", "text": text]) }
        task = nil; request = nil
        if running { newRequest() }
    }
    func stop() {
        running = false
        silence?.invalidate()
        engine.stop(); engine.inputNode.removeTap(onBus: 0)
        request?.endAudio(); task?.finish()
        if !lastText.isEmpty { send?(["type": "final", "text": lastText]); lastText = "" }
        send?(["type": "end"])
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var statusItem: NSStatusItem!
    let speech = Transcriber()
    let defaults = UserDefaults.standard
    // The board and settings live as plain JSON files here, written on every change.
    lazy var storeDir: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent(appName, isDirectory: true)
        // Before the rename the app was called Tracker: move its data over once.
        let old = base.appendingPathComponent("Tracker", isDirectory: true)
        if !FileManager.default.fileExists(atPath: d.path), FileManager.default.fileExists(atPath: old.path) { try? FileManager.default.moveItem(at: old, to: d) }
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    let storeKeys = ["pm-tracker-v1": "board.json", "pm-tracker-prefs": "settings.json", "pm-tracker-theme": "theme.txt"]
    func storeSnapshot() -> [String: String] {
        var out: [String: String] = [:]
        for (k, f) in storeKeys { if let s = try? String(contentsOf: storeDir.appendingPathComponent(f), encoding: .utf8) { out[k] = s } }
        return out
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        buildMenu()
        let config = WKWebViewConfiguration()
        let root = Bundle.main.resourceURL!.appendingPathComponent("web")
        config.setURLSchemeHandler(BundleScheme(root: root), forURLScheme: "tracker")
        config.userContentController.add(self, name: "tracker")
        let firstName = NSFullUserName().split(separator: " ").first.map(String.init) ?? ""
        let boot = "window.__trackerStore=" + Self.json(storeSnapshot()) + ";window.__trackerUser=" + Self.json(firstName) + ";"
        config.userContentController.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.websiteDataStore = .default()
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        if #available(macOS 13.3, *) { web.isInspectable = true }
        web.setValue(false, forKey: "drawsBackground")

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1120, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = appName
        window.minSize = NSSize(width: 420, height: 480)
        window.contentView = web
        window.delegate = self
        let hadFrame = defaults.object(forKey: "NSWindow Frame FollowthroughMain") != nil
        window.setFrameAutosaveName("FollowthroughMain")
        if !hadFrame { window.center() }
        if let screen = window.screen ?? NSScreen.main, !screen.visibleFrame.intersects(window.frame) { window.center() }
        window.level = defaults.bool(forKey: "keepOnTop") ? .floating : .normal
        window.collectionBehavior = [.managed, .fullScreenPrimary]
        window.makeKeyAndOrderFront(nil)

        speech.send = { [weak self] ev in self?.js("window.__trackerNative.speech(\(Self.json(ev)))") }
        web.load(URLRequest(url: URL(string: "tracker://app/index.html")!))

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let b = statusItem.button {
            b.image = NSImage(systemSymbolName: "checklist", accessibilityDescription: appName)
            b.action = #selector(statusClicked); b.target = self
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows: Bool) -> Bool { showWindow(); return true }
    func windowShouldClose(_ w: NSWindow) -> Bool { w.orderOut(nil); return false }

    // MARK: menus
    func buildMenu() {
        let main = NSMenu()
        let app = NSMenu(); let appItem = NSMenuItem(); appItem.submenu = app; main.addItem(appItem)
        app.addItem(withTitle: "About \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(item("Keep on Top", #selector(toggleTop), "t", [.command, .shift]))
        app.addItem(item("Open at Login", #selector(toggleLogin), "", []))
        app.addItem(.separator())
        app.addItem(withTitle: "Hide \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Quit \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenu(title: "Edit"); let editItem = NSMenuItem(); editItem.submenu = edit; main.addItem(editItem)
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        let win = NSMenu(title: "Window"); let winItem = NSMenuItem(); winItem.submenu = win; main.addItem(winItem)
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(item("Reload", #selector(reload), "r", [.command]))
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }
    func item(_ title: String, _ sel: Selector, _ key: String, _ mods: NSEvent.ModifierFlags) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: sel, keyEquivalent: key); i.keyEquivalentModifierMask = mods; i.target = self; return i
    }
    func statusMenu() -> NSMenu {
        let m = NSMenu()
        m.addItem(item(window.isVisible ? "Hide Followthrough" : "Show Followthrough", #selector(toggleWindow), "", []))
        m.addItem(.separator())
        m.addItem(item("Keep on Top", #selector(toggleTop), "", []))
        m.addItem(item("Open at Login", #selector(toggleLogin), "", []))
        m.addItem(.separator())
        m.addItem(item("Quit Followthrough", #selector(quit), "", []))
        return m
    }
    @objc func statusClicked() {
        if NSApp.currentEvent?.type == .rightMouseUp { statusItem.menu = statusMenu(); statusItem.button?.performClick(nil); statusItem.menu = nil }
        else { toggleWindow() }
    }
    @objc func toggleWindow() { window.isVisible && NSApp.isActive ? window.orderOut(nil) : showWindow() }
    func showWindow() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil) }
    @objc func toggleTop() { let on = !defaults.bool(forKey: "keepOnTop"); defaults.set(on, forKey: "keepOnTop"); window.level = on ? .floating : .normal }
    @objc func toggleLogin() {
        let s = SMAppService.mainApp
        do { if s.status == .enabled { try s.unregister() } else { try s.register() } }
        catch { let a = NSAlert(); a.messageText = "Couldn't change Open at Login"; a.informativeText = "Move Followthrough to your Applications folder, then try again. (\(error.localizedDescription))"; a.runModal() }
    }
    @objc func reload() { web.reload() }
    @objc func quit() { NSApp.terminate(nil) }
    func validateMenuItem(_ i: NSMenuItem) -> Bool {
        if i.action == #selector(toggleTop) { i.state = defaults.bool(forKey: "keepOnTop") ? .on : .off }
        if i.action == #selector(toggleLogin) { i.state = SMAppService.mainApp.status == .enabled ? .on : .off }
        return true
    }

    // MARK: links open in the default browser
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, u.scheme == "http" || u.scheme == "https" || u.scheme == "mailto" { NSWorkspace.shared.open(u); decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { NSWorkspace.shared.open(u) }; return nil
    }

    // MARK: bridge from the page
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let msg = m.body as? [String: Any], let id = msg["id"] as? String, let kind = msg["kind"] as? String else { return }
        switch kind {
        case "fetch": fetch(id, msg)
        case "saveFile": saveFile(id, msg)
        case "store.set":
            guard let key = msg["key"] as? String, let file = storeKeys[key] else { reply(id, false, ["code": "error", "message": "Unknown key"]); return }
            let url = storeDir.appendingPathComponent(file)
            do {
                if let v = msg["value"] as? String { try v.write(to: url, atomically: true, encoding: .utf8) } else { try? FileManager.default.removeItem(at: url) }
                reply(id, true, [:])
            } catch { reply(id, false, ["code": "error", "message": error.localizedDescription]) }
        case "store.reveal": NSWorkspace.shared.activateFileViewerSelecting([storeDir]); reply(id, true, [:])
        case "copy":
            NSPasteboard.general.clearContents(); NSPasteboard.general.setString(msg["text"] as? String ?? "", forType: .string); reply(id, true, [:])
        case "speech.start": speech.start(lang: msg["lang"] as? String ?? "en-US") { [weak self] ok, data in self?.reply(id, ok, data) }
        case "speech.stop": speech.stop(); reply(id, true, [:])
        default: reply(id, false, ["code": "unknown", "message": "Unknown request"])
        }
    }
    func fetch(_ id: String, _ msg: [String: Any]) {
        guard let s = msg["url"] as? String, let url = URL(string: s), ["https", "http"].contains(url.scheme ?? "") else { reply(id, false, ["code": "network", "message": "Bad URL"]); return }
        var req = URLRequest(url: url, timeoutInterval: 300)
        req.httpMethod = msg["method"] as? String ?? "GET"
        (msg["headers"] as? [String: String])?.forEach { req.setValue($0.value, forHTTPHeaderField: $0.key) }
        if let b = msg["body"] as? String { req.httpBody = b.data(using: .utf8) }
        URLSession.shared.dataTask(with: req) { data, resp, err in
            DispatchQueue.main.async {
                if let err { self.reply(id, false, ["code": "network", "message": err.localizedDescription]); return }
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                self.reply(id, true, ["status": status, "text": String(data: data ?? Data(), encoding: .utf8) ?? ""])
            }
        }.resume()
    }
    func saveFile(_ id: String, _ msg: [String: Any]) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = msg["name"] as? String ?? "followthrough-backup.json"
        panel.allowedContentTypes = [.json]
        panel.beginSheetModal(for: window) { r in
            guard r == .OK, let url = panel.url else { self.reply(id, false, ["code": "cancelled"]); return }
            do { try (msg["data"] as? String ?? "").write(to: url, atomically: true, encoding: .utf8); self.reply(id, true, [:]) }
            catch { self.reply(id, false, ["code": "error", "message": error.localizedDescription]) }
        }
    }
    func reply(_ id: String, _ ok: Bool, _ data: [String: Any]) { js("window.__trackerNative.reply(\(Self.json(id)),\(ok),\(Self.json(data)))") }
    func js(_ s: String) { web.evaluateJavaScript(s, completionHandler: nil) }
    static func json(_ v: Any) -> String {
        if let s = v as? String { return (try? String(data: JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)).map { String($0.dropFirst().dropLast()) } ?? "\"\"" }
        return (try? String(data: JSONSerialization.data(withJSONObject: v), encoding: .utf8)) ?? "{}"
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
