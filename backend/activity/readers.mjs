import fs from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { StringDecoder } from "node:string_decoder";

const MAX_FRAME = 64 * 1024 * 1024;
function frameLength(buffer) {
  if (buffer.length < 5) return null;
  const magic = buffer.readUInt32LE(0);
  if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
    if (buffer.length < 8) return null;
    const length = 8 + buffer.readUInt32LE(4);
    if (length > MAX_FRAME) throw new Error("压缩帧超过读取上限");
    return buffer.length < length ? null : length;
  }
  if (magic !== 0xfd2fb528) throw new Error("无效的 Zstandard 帧");
  const descriptor = buffer[4], single = !!(descriptor & 32), sizeFlag = descriptor >> 6;
  if (descriptor & 8) throw new Error("未知的 Zstandard 帧格式");
  let offset = 5 + (single ? 0 : 1) + [0, 1, 2, 4][descriptor & 3] + (sizeFlag ? [0, 2, 4, 8][sizeFlag] : single ? 1 : 0);
  for (;;) {
    if (buffer.length < offset + 3) return null;
    const block = buffer.readUIntLE(offset, 3), type = (block >> 1) & 3;
    if (type === 3) throw new Error("未知的 Zstandard 数据块");
    offset += 3 + (type === 1 ? 1 : block >>> 3);
    if (offset > MAX_FRAME) throw new Error("压缩帧超过读取上限");
    if (block & 1) {
      offset += descriptor & 4 ? 4 : 0;
      return buffer.length >= offset ? offset : null;
    }
  }
}
async function* chunks(filename, compressed, cancelled) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(filename, { highWaterMark: 1024 * 1024 })) {
    if (cancelled()) throw Object.assign(new Error("扫描已取消"), { code: "CANCELLED" });
    if (!compressed) { yield chunk; continue; }
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length) {
      // 原生解码器可能接受不完整帧，先验证物理边界，避免把半写入内容当成完整日志。
      const length = frameLength(buffer);
      if (length === null) break;
      const frame = buffer.subarray(0, length);
      buffer = buffer.subarray(length);
      if (frame.readUInt32LE(0) === 0xfd2fb528) yield zstdDecompressSync(frame, { maxOutputLength: MAX_FRAME });
    }
    if (buffer.length > MAX_FRAME) throw new Error("压缩帧超过读取上限");
  }
  if (buffer.length) throw new Error("压缩日志尾部尚未完整写入");
}

export async function* readRecords(filename, { compressed = false, cancelled = () => false } = {}) {
  const decoder = new StringDecoder("utf8");
  let buffer = "", line = 0;
  const parse = value => {
    line++;
    if (!value.trim()) return null;
    try {
      const row = JSON.parse(value.replace(/^\uFEFF/, ""));
      return row && typeof row === "object" && !Array.isArray(row) ? { row: { ...row, line }, line } : { error: "invalid_record", line };
    } catch { return { error: "invalid_json", line }; }
  };
  for await (const chunk of chunks(filename, compressed, cancelled)) {
    buffer += decoder.write(chunk);
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      if (cancelled()) throw Object.assign(new Error("扫描已取消"), { code: "CANCELLED" });
      const result = parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      if (result) yield result;
    }
    if (buffer.length > 16 * 1024 * 1024) throw new Error("日志单行超过读取上限");
  }
  buffer += decoder.end();
  if (buffer.trim()) yield parse(buffer);
}
