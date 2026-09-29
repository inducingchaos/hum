// UI smoke tests on the Simulator in demo mode (plan-ios §9, §11), both looks.
// Screenshots are attached to the result bundle; CI exports them as an artifact.
import XCTest

final class HumUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  @MainActor private func launch(_ look: String, short: Bool = false) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-demo", "YES", "-demoReset", "YES", "-initialLook", look] + (short ? ["-demoShort", "YES"] : [])
    app.launch()
    return app
  }

  @MainActor private func shot(_ name: String) {
    let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    a.name = name
    a.lifetime = .keepAlways
    add(a)
  }

  @MainActor private func waitForChange(_ el: XCUIElement, from old: String, timeout: TimeInterval = 10) -> Bool {
    let p = NSPredicate(format: "label != %@", old)
    return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: el)], timeout: timeout) == .completed
  }

  @MainActor private func waitForLabel(_ el: XCUIElement, matching regex: String, timeout: TimeInterval = 10) -> Bool {
    let p = NSPredicate(format: "label MATCHES %@", regex)
    return XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: p, object: el)], timeout: timeout) == .completed
  }

  @MainActor func testTerminalLook() {
    let app = launch("terminal")
    let title = app.staticTexts["title"]
    XCTAssertTrue(title.waitForExistence(timeout: 15))
    shot("terminal-1-now")
    app.buttons["playpause"].tap()
    XCTAssertTrue(waitForLabel(app.staticTexts["time"], matching: "0:0[1-9] / .*"), "clock should move while playing")
    let first = title.label
    app.buttons["next"].tap()
    XCTAssertTrue(waitForChange(title, from: first), "next should change the track")
    app.buttons["filter"].tap()
    app.buttons["chip.noon"].tap()
    shot("terminal-2-filter")
    app.buttons["filter.apply"].tap()
    XCTAssertTrue(app.staticTexts["title"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'noon /'")).firstMatch.waitForExistence(timeout: 5))
    shot("terminal-3-filtered")
    app.buttons["tab.queue"].tap()
    shot("terminal-4-queue")
    app.buttons["tab.sys"].tap()
    shot("terminal-5-sys")
    app.buttons["sys.native"].tap()
    XCTAssertTrue(app.tabBars.buttons["Queue"].waitForExistence(timeout: 5), "switching looks shows the native tab bar")
  }

  @MainActor func testNativeLook() {
    let app = launch("native")
    let title = app.staticTexts["title"]
    XCTAssertTrue(title.waitForExistence(timeout: 15))
    shot("native-1-now")
    app.buttons["playpause"].tap()
    XCTAssertTrue(waitForLabel(app.staticTexts["time"], matching: "0:0[1-9]"), "clock should move while playing")
    let first = title.label
    app.buttons["next"].tap()
    XCTAssertTrue(waitForChange(title, from: first))
    app.buttons["filter"].tap()
    let field = app.textFields["filter.field"]
    let opened = field.waitForExistence(timeout: 5)
    shot("native-2-filter")
    XCTAssertTrue(opened, "the filter sheet should open")
    let chip = app.buttons["chip.noon"]
    XCTAssertTrue(chip.waitForExistence(timeout: 5), "chips: \(app.buttons.allElementsBoundByIndex.map(\.identifier))")
    chip.tap()
    app.buttons["filter.apply"].tap()
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'noon /'")).firstMatch.waitForExistence(timeout: 5))
    shot("native-3-filtered")
    app.tabBars.buttons["Queue"].tap()
    shot("native-4-queue")
    app.tabBars.buttons["Settings"].tap()
    shot("native-5-settings")
  }

  // Tracks are 4 s long: the next one must start by itself (the gapless boundary).
  @MainActor func testAutoAdvance() {
    let app = launch("terminal", short: true)
    let title = app.staticTexts["title"]
    XCTAssertTrue(title.waitForExistence(timeout: 15))
    let first = title.label
    app.buttons["playpause"].tap()
    XCTAssertTrue(waitForChange(title, from: first, timeout: 15), "the next track should start by itself")
    let second = title.label
    XCTAssertTrue(waitForChange(title, from: second, timeout: 15), "and the one after")
    XCTAssertEqual(app.buttons["playpause"].label, "Pause")
  }
}
