import assert from "node:assert/strict";
import { test } from "node:test";
import { invoke } from "../../src/lib/transport.ts";
import { getErrorKind } from "../../src/lib/error.ts";

test("HTTP 传输保留可供页面识别的取消错误类型", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    ok: false, code: "CANCELLED", kind: "cancelled", message: "操作已取消",
  })));
  await assert.rejects(invoke("preview_git_install"), error => {
    assert.equal(getErrorKind(error), "cancelled");
    assert.equal(error.code, "CANCELLED");
    assert.equal(error.message, "操作已取消");
    return true;
  });
});

test("HTTP 传输仍保留普通错误代码且不伪装成取消", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    ok: false, code: "ERROR", message: "来源不存在",
  })));
  await assert.rejects(invoke("preview_git_install"), error => {
    assert.equal(getErrorKind(error), undefined);
    assert.equal(error.code, "ERROR");
    assert.equal(error.message, "来源不存在");
    return true;
  });
});
