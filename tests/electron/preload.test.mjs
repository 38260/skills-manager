import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

test("桌面桥只通过受控 IPC 调用主进程并保留返回值与失败", async () => {
  let bridge;
  const calls = [];
  const results = new Map([["desktop:open-directory", "D:/acceptance"], ["desktop:open-skill-file", "D:/acceptance.zip"], ["desktop:confirm", false]]);
  const electron = {
    contextBridge: { exposeInMainWorld: (name, api) => { assert.equal(name, "__desktopBridge__"); bridge = api; } },
    ipcRenderer: { invoke: async (channel, ...args) => {
      calls.push([channel, ...args]);
      if (args[0] === "invalid") throw new Error("无效的外部链接");
      return results.get(channel);
    } },
  };
  vm.runInNewContext(fs.readFileSync(new URL("../../electron/preload.cjs", import.meta.url), "utf8"), {
    require: name => { assert.equal(name, "electron"); return electron; },
  });
  assert.equal(await bridge.openDirectory(), "D:/acceptance");
  results.set("desktop:open-directory", null);
  assert.equal(await bridge.openDirectory(), null);
  assert.equal(await bridge.openSkillFile(), "D:/acceptance.zip");
  assert.equal(await bridge.confirm("确认验收"), false);
  await bridge.openExternal("https://example.com");
  await assert.rejects(bridge.openExternal("invalid"), /无效的外部链接/);
  assert.deepEqual(calls, [["desktop:open-directory"], ["desktop:open-directory"], ["desktop:open-skill-file"], ["desktop:confirm", "确认验收"],
    ["desktop:open-external", "https://example.com"], ["desktop:open-external", "invalid"]]);
});
