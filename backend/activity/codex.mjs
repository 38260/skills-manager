import { contentText, object, skillFromPath } from "./context.mjs";

// 只识别明确的文件读取命令；搜索、打印路径、脚本写入及复杂条件执行保持未知。
export function documentPaths(name, input) {
  const args = object(input);
  if (/(?:^|[._])(?:read_file|read_text_file|read)$/i.test(name)) {
    const filename = args.path ?? args.file_path ?? args.file;
    return typeof filename === "string" && /(?:^|[/\\])SKILL\.md$/i.test(filename) ? [filename] : [];
  }
  let commands = [];
  if (typeof args.cmd === "string") commands.push(args.cmd);
  if (typeof args.command === "string") commands.push(args.command);
  if (typeof input === "string" && !commands.length) {
    for (const match of input.matchAll(/\bcmd\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g)) {
      try { commands.push(match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1).replace(/\\'/g, "'")); } catch { /* 无法解析的脚本文本不作为读取证据。 */ }
    }
  }
  const found = [];
  for (const command of commands) {
    if (/[|><`]|\$\(|\b(?:if|for|while|echo|printf|Write-Output)\b/i.test(command)) continue;
    for (const part of command.split(/;|&&|\r?\n/)) {
      if (!/^\s*(?:cat|head|tail|sed\s+-n|Get-Content)\s/i.test(part)) continue;
      const tokens = [...part.matchAll(/"([^"]+)"|'([^']+)'|([^\s]+)/g)].map(match => match[1] ?? match[2] ?? match[3]);
      for (let filename of tokens) if (/(?:^|[/\\])SKILL\.md$/i.test(filename) && !filename.includes("$")) {
        if (!/^(?:[a-z]:[/\\]|\/)/i.test(filename)) {
          const base = args.workdir ?? args.cwd;
          if (typeof base !== "string") continue;
          filename = `${base.replace(/[/\\]$/, "")}/${filename}`;
        }
        found.push(filename);
      }
    }
  }
  return [...new Set(found)];
}

function outputStatus(output) {
  const text = contentText(output);
  const codes = [...text.matchAll(/(?:"exit_code"\s*:\s*|Process exited with code\s+|Exit code:\s*)(-?\d+)/g)].map(match => Number(match[1]));
  if (codes.length) return codes.every(code => code === 0) ? "returned" : "failed";
  const data = object(output);
  if (data.isError === true) return "failed";
  if (data.exit_code === 0 || data.isError === false) return "returned";
  return "unknown";
}

export function parseCodex(row, ctx) {
  const data = row.payload;
  if (!data || typeof data !== "object") return;
  if (row.type === "session_meta") {
    ctx.recognized++; ctx.sessionId = data.id || data.session_id || ctx.sessionId; ctx.project = data.cwd || null;
  } else if (row.type === "turn_context") {
    ctx.recognized++; ctx.project = data.cwd || ctx.project;
  } else if (row.type === "response_item") {
    ctx.recognized++;
    if (data.type === "message" && data.role === "user") {
      const selections = Array.isArray(data.content) ? data.content.filter(item => item.type === "skill" && item.name).map(item => ({ name: item.name, path: item.path })) : [];
      ctx.user(data.content, { ...row, id: data.id }, selections);
    }
    if (["custom_tool_call", "function_call"].includes(data.type)) {
      const args = object(data.arguments ?? data.input);
      if (/^(?:functions\.)?skill$/i.test(data.name || "")) {
        ctx.call({ id: data.call_id, name: args.skill ?? args.name, row });
      } else {
        for (const filename of documentPaths(data.name || "", data.arguments ?? data.input)) {
          ctx.call({ id: data.call_id, name: skillFromPath(filename), skillPath: filename, kind: "document", row });
        }
      }
    }
    if (["custom_tool_call_output", "function_call_output"].includes(data.type)) ctx.result(data.call_id, outputStatus(data.output));
  }
}
