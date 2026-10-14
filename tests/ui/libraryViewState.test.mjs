import assert from "node:assert/strict";
import { test } from "node:test";
import { readLibraryViewState, restoreLibraryScroll, writeLibraryViewState } from "../../src/lib/libraryViewState.ts";

function memoryStorage() {
  const data = new Map();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

const state = {
  viewMode: "list", filterMode: "enabled", search: "my skill", sourceFilters: ["github"], tagFilters: [], scrollTop: 720,
};

test("returning to a preset restores search, filters, position, and the library view preference", () => {
  const storage = { session: memoryStorage(), preferences: memoryStorage() };
  writeLibraryViewState("D:\\Skills\\Library", "preset-a", state, storage);
  assert.deepEqual(readLibraryViewState("d:/skills/library/", "preset-a", storage), state);
  assert.deepEqual(readLibraryViewState("D:/Skills/Library", "preset-b", storage), {
    viewMode: "list", filterMode: "all", search: "", sourceFilters: [], tagFilters: [], scrollTop: 0,
  });
  assert.equal(readLibraryViewState("D:/OtherLibrary", "preset-a", storage).viewMode, "grid");
  assert.equal(readLibraryViewState("D:/OtherLibrary", "preset-a", storage).search, "");
  writeLibraryViewState("D:/Library", null, state, storage);
  assert.equal(readLibraryViewState("D:/Library", "library", storage).search, "");
});

test("a new session keeps view preference and starts with clean search and filters", () => {
  const preferences = memoryStorage();
  writeLibraryViewState("D:/Library", null, state, { session: memoryStorage(), preferences });
  const next = readLibraryViewState("D:/Library", null, { session: memoryStorage(), preferences });
  assert.equal(next.viewMode, "list");
  assert.equal(next.search, "");
  assert.equal(next.scrollTop, 0);
});

test("corrupt or unavailable browser storage never blocks browsing", () => {
  const session = memoryStorage();
  const preferences = memoryStorage();
  writeLibraryViewState("library", null, state, { session, preferences });
  const key = [...session.data.keys()][0];
  session.setItem(key, "{broken");
  assert.equal(readLibraryViewState("library", null, { session, preferences }).search, "");
  session.setItem(key, JSON.stringify({ filterMode: "wrong", search: 9, sourceFilters: ["github", 4], tagFilters: ["UI", "UI", null], scrollTop: -10 }));
  assert.deepEqual(readLibraryViewState("library", null, { session, preferences }), {
    viewMode: "list", filterMode: "all", search: "", sourceFilters: [], tagFilters: ["UI"], scrollTop: 0,
  });
  const denied = { getItem() { throw new Error("disabled"); }, setItem() { throw new Error("full"); } };
  assert.doesNotThrow(() => writeLibraryViewState("library", null, state, { session: denied, preferences: denied }));
  assert.equal(readLibraryViewState("library", null, { session: denied, preferences: denied }).viewMode, "grid");
});

test("scroll restoration waits for layout and yields to user navigation", () => {
  const originalRequest = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  const frames = new Map();
  let nextFrame = 0;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const tick = () => { const pending = [...frames]; frames.clear(); pending.forEach(([, callback]) => callback()); };
  const container = Object.assign(new EventTarget(), { scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
  try {
    restoreLibraryScroll(container, 720);
    tick();
    assert.equal(container.scrollTop, 0);
    container.scrollHeight = 2000;
    tick();
    assert.equal(container.scrollTop, 720);
    assert.equal(frames.size, 0);
    container.scrollHeight = 100;
    restoreLibraryScroll(container, 720);
    container.dispatchEvent(new Event("wheel"));
    container.scrollHeight = 2000;
    container.scrollTop = 300;
    tick();
    assert.equal(container.scrollTop, 300);
    container.scrollHeight = 500;
    restoreLibraryScroll(container, 720);
    for (let index = 0; index < 30; index++) tick();
    assert.equal(container.scrollTop, 400);
    assert.equal(frames.size, 0);
  } finally {
    if (originalRequest) globalThis.requestAnimationFrame = originalRequest; else delete globalThis.requestAnimationFrame;
    if (originalCancel) globalThis.cancelAnimationFrame = originalCancel; else delete globalThis.cancelAnimationFrame;
  }
});
