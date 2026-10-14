import assert from "node:assert/strict";
import { test } from "node:test";
import { getDesktopCapabilities } from "../../src/lib/desktopCapabilities.ts";

for (const runtime of ["browser", "electron"]) {
  test(`${runtime} on Windows never claims Tauri-only capabilities`, () => {
    const capabilities = getDesktopCapabilities(runtime, "Mozilla/5.0 (Windows NT 10.0)");
    assert.equal(capabilities.runtime, runtime);
    for (const name of ["tray", "closeAction", "proxy", "skillUpdateSchedule", "installAppUpdate"]) {
      assert.equal(capabilities[name], false, name);
    }
  });
}

test("Tauri keeps desktop preferences and only offers native installation on supported platforms", () => {
  for (const userAgent of ["Windows NT 10.0", "Macintosh; Intel Mac OS X 14_0", "X11; Linux x86_64"]) {
    const capabilities = getDesktopCapabilities("tauri", userAgent);
    assert.equal(capabilities.tray, true);
    assert.equal(capabilities.closeAction, true);
    assert.equal(capabilities.proxy, true);
    assert.equal(capabilities.skillUpdateSchedule, true);
    assert.equal(capabilities.installAppUpdate, !userAgent.includes("Linux"));
  }
  assert.equal(getDesktopCapabilities("tauri", "").installAppUpdate, false);
});
