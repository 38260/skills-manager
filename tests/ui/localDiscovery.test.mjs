import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCAL_DISCOVERY_COOLDOWN_MS,
  LocalDiscoveryCoordinator,
  collectCandidateKeys,
  mergeNotifiedKeys,
  newPendingGroups,
  parseNotifiedKeys,
} from "../../src/lib/localDiscovery.ts";

function group(name, keys, { imported = false, fingerprint = "fp-1" } = {}) {
  return {
    name,
    key: keys[0],
    fingerprint,
    imported,
    found_at: 1,
    locations: keys.map((key, index) => ({
      id: `${name}-${index}`,
      key,
      tool: "custom_discovery",
      found_path: key.replace(/^path:/, ""),
    })),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("候选去重按稳定路径判断：同一组多个位置只算一个，内容变化、减少或已导入都不算新增", () => {
  const alpha = group("alpha", ["path:C:/skills/alpha"]);
  const beta = group("beta", ["path:C:/skills/beta"], { imported: true });
  const gamma = group("gamma", ["path:C:/skills/gamma-a", "path:C:/skills/gamma-b"]);

  assert.deepEqual(newPendingGroups([alpha, beta, gamma], new Set()).map(item => item.name), ["alpha", "gamma"]);
  assert.deepEqual(newPendingGroups([alpha, beta, gamma], new Set(["path:C:/skills/alpha"])).map(item => item.name), ["gamma"]);
  assert.deepEqual(
    newPendingGroups([alpha, beta, gamma], new Set(["path:C:/skills/alpha", "path:C:/skills/gamma-b"])),
    [],
    "组内任一位置已通知过，整组都不重复通知"
  );

  const alphaEdited = group("alpha", ["path:C:/skills/alpha"], { fingerprint: "fp-changed" });
  assert.deepEqual(newPendingGroups([alphaEdited], new Set(["path:C:/skills/alpha"])), [], "内容变化不误报新增");
  assert.deepEqual(newPendingGroups([], new Set(["path:C:/skills/alpha"])), [], "候选消失或数量下降不误报");
  assert.deepEqual(newPendingGroups([alphaEdited], new Set(["path:C:/skills/alpha"])).length, 0);
});

test("去重状态可跨重启解析并在扫描后合并；导入项也写入路径基线", () => {
  assert.equal(parseNotifiedKeys(null), null);
  assert.equal(parseNotifiedKeys("not json"), null);
  assert.equal(parseNotifiedKeys('{"unexpected":true}'), null);
  assert.deepEqual([...parseNotifiedKeys('["path:a","path:b",1,null]')], ["path:a", "path:b"]);

  const persisted = parseNotifiedKeys('["path:C:/skills/alpha"]');
  const alpha = group("alpha", ["path:C:/skills/alpha"]);
  const beta = group("beta", ["path:C:/skills/beta"]);
  const imported = group("old", ["path:C:/skills/old"], { imported: true });
  assert.deepEqual(newPendingGroups([alpha, beta, imported], persisted).map(item => item.name), ["beta"]);

  const merged = mergeNotifiedKeys(persisted, [alpha, beta, imported]);
  assert.deepEqual([...merged].sort(), [
    "path:C:/skills/alpha",
    "path:C:/skills/beta",
    "path:C:/skills/old",
  ]);
  assert.deepEqual(collectCandidateKeys([alpha, beta, imported]).sort(), [...merged].sort());
});

test("扫描协调器合并 focus/visibility 连发，自动扫描冷却 30 秒，手动绕过冷却但不重叠", async () => {
  let now = 0;
  let runs = 0;
  const pending = [];
  const coordinator = new LocalDiscoveryCoordinator({
    now: () => now,
    cooldownMs: LOCAL_DISCOVERY_COOLDOWN_MS,
    run: trigger => {
      runs += 1;
      const task = deferred();
      pending.push({ trigger, ...task });
      return task.promise;
    },
  });

  const focus = coordinator.request("focus");
  assert.equal(focus.started, true);
  assert.equal(coordinator.scanning, true);
  const visibility = coordinator.request("visibility");
  assert.equal(visibility.reason, "in-flight");
  const manualDuringAuto = coordinator.request("manual");
  assert.equal(manualDuringAuto.reason, "in-flight", "手动扫描不能创建重叠任务");
  assert.equal(manualDuringAuto.promise, focus.promise);
  await Promise.resolve();
  assert.equal(runs, 1);

  pending[0].resolve("ok");
  await focus.promise;
  assert.equal(coordinator.scanning, false);

  now = 10_000;
  const cooling = coordinator.request("focus");
  assert.equal(cooling.reason, "cooldown");
  assert.equal(cooling.promise, null);

  now = 30_000;
  const interval = coordinator.request("interval");
  assert.equal(interval.started, true, "冷却结束后自动扫描恢复");
  await Promise.resolve();
  pending[1].resolve("ok");
  await interval.promise;

  now = 31_000;
  const manual = coordinator.request("manual");
  assert.equal(manual.started, true, "手动扫描绕过冷却");
  await Promise.resolve();
  pending[2].resolve("ok");
  await manual.promise;

  now = 32_000;
  const startup = coordinator.request("startup");
  assert.equal(startup.reason, "cooldown", "启动扫描仍遵守自动冷却，避免重复扫描");
  now = 62_000;
  const startupRetry = coordinator.request("startup");
  assert.equal(startupRetry.started, true);
  await Promise.resolve();
  pending[3].resolve("ok");
  await startupRetry.promise;
  assert.equal(runs, 4);
});

test("扫描协调器在任务失败后恢复空闲，并支持等待当前任务结束", async () => {
  let now = 0;
  let runs = 0;
  const coordinator = new LocalDiscoveryCoordinator({
    now: () => now,
    cooldownMs: 30_000,
    run: () => {
      runs += 1;
      return runs === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("ok");
    },
  });

  const failed = coordinator.request("focus");
  await assert.rejects(failed.promise, /boom/);
  assert.equal(coordinator.scanning, false);
  await coordinator.waitForIdle();

  now = 1_000;
  const manual = coordinator.request("manual");
  assert.equal(manual.started, true);
  await manual.promise;
  assert.equal(runs, 2);
});
