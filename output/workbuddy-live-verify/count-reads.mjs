import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(os.homedir(), ".workbuddy", "projects");
let files = 0, reads = 0, sessions = 0;
for (const dir of fs.readdirSync(root)) {
  const full = path.join(root, dir);
  if (!fs.statSync(full).isDirectory()) continue;
  for (const file of fs.readdirSync(full)) {
    if (!file.endsWith(".jsonl")) continue;
    files++;
    let has = false;
    for (const line of fs.readFileSync(path.join(full, file), "utf8").split(/\r?\n/)) {
      if (!line.includes("\"name\":\"Read\"") && !line.includes("\"name\": \"Read\"")) continue;
      try {
        const row = JSON.parse(line);
        if (row.type !== "function_call" || row.name !== "Read") continue;
        const args = typeof row.arguments === "string" ? JSON.parse(row.arguments) : row.arguments;
        const filePath = String(args?.file_path || "").split("\\").join("/").toLowerCase();
        if (filePath.endsWith("/skill.md")) { reads++; has = true; }
      } catch {}
    }
    if (has) sessions++;
  }
}
console.log({ files, sessions, reads });
