// skills.sh 市场数据：排行榜抓取与搜索接口。
// 站点结构变化时返回空列表而不是抛错，由调用方提示用户稍后再试。
const TIMEOUT_MS = 15000;
const MARKER = '<script id="__NEXT_DATA__" type="application/json">';
// App Router 起，页面数据不再走 __NEXT_DATA__，而是分片推在
// `self.__next_f.push([1,"<RSC 载荷>"])` 里；载荷是 JS 字符串字面量（内层引号被转义），
// 必须逐片反转义后拼接才能拼出完整 JSON。
const RSC_CHUNK = /self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g;

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "skills-manager" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`skills.sh 请求失败（HTTP ${response.status}）`);
  return response.text();
}

/** 三个榜单页共用同一套字段：installs 是下载量；hot 榜另给 change（较昨日增量）。 */
function normalize(items) {
  const seen = new Set();
  const skills = [];
  for (const item of items ?? []) {
    const source = String(item.source ?? "");
    const skillId = String(item.skillId ?? item.skill_id ?? item.id ?? "");
    if (!source || !skillId) continue;
    const id = `${source}/${skillId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const installs = Number(item.installs ?? 0);
    const change = Number(item.change ?? 0);
    skills.push({
      id, skill_id: skillId, name: String(item.name ?? "") || skillId, source,
      installs: Number.isFinite(installs) ? installs : 0,
      change: Number.isFinite(change) && change > 0 ? change : 0,
      official: item.isOfficial === true,
    });
  }
  return skills;
}

/** 把 RSC 的分片载荷反转义并拼成一份文本；坏片跳过，不影响其余数据。 */
function decodeRsc(html) {
  let text = "";
  for (const match of html.matchAll(RSC_CHUNK)) {
    try { text += JSON.parse(match[1]); } catch { /* 单个分片解析失败就跳过 */ }
  }
  return text;
}

/** 取 marker 之后第一个完整的 JSON 数组字面量（跳过字符串内的括号），找不到返回 null。 */
function extractArray(text, marker) {
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const start = text.indexOf("[", at);
  if (start < 0) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** 当前（2026-10）站点结构：排行榜把列表放在 RSC 树的 initialSkills 下，三个榜单同构。 */
function parseRsc(html) {
  const text = decodeRsc(html);
  if (!text) return [];
  const raw = extractArray(text, '"initialSkills":');
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

/** 旧结构（Next.js Pages Router）保留兼容。 */
function parseNextData(html) {
  const start = html.indexOf(MARKER);
  if (start < 0) return [];
  const end = html.indexOf("</script>", start);
  if (end < 0) return [];
  try {
    const data = JSON.parse(html.slice(start + MARKER.length, end));
    const props = data?.props?.pageProps ?? {};
    return props.initialSkills ?? props.skills ?? props.items ?? [];
  } catch { return []; }
}

// 兜底：直接在反转义文本里抓 source / skillId / installs 三元组。
// installs 必须写成**必选**组 —— 写成 `(?:..."installs":(\d+))?` 时，正则引擎会优先走
// 「跳过该可选组」的路径，结果每条 installs 都取不到、全为 0（2026-10 实际踩过这个坑）。
function parseEmbedded(html) {
  const text = html.replace(/\\"/g, '"').replace(/\\+/g, "\\");
  const pattern = /\{"source":"([^"\s]+)","(?:skill_id|skillId)":"([^"\s]+)"[^{}]*?"installs":(\d+)[^{}]*\}/g;
  const items = [];
  for (const match of text.matchAll(pattern)) {
    items.push({ source: match[1], skill_id: match[2], name: "", installs: Number(match[3]) });
  }
  return normalize(items);
}

function parseSkills(html) {
  const rsc = normalize(parseRsc(html));
  if (rsc.length) return rsc;
  const legacy = normalize(parseNextData(html));
  if (legacy.length) return legacy;
  return parseEmbedded(html);
}

export async function fetchLeaderboard(board) {
  const url = board === "trending" ? "https://skills.sh/trending" : board === "hot" ? "https://skills.sh/hot" : "https://skills.sh/";
  return parseSkills(await fetchText(url));
}

export async function searchSkills(query, limit) {
  const url = `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=${Math.max(1, Number(limit) || 20)}`;
  const response = await fetch(url, { headers: { "user-agent": "skills-manager" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`skills.sh 搜索失败（HTTP ${response.status}）`);
  const data = await response.json();
  if (Array.isArray(data)) return normalize(data);
  return normalize(data?.skills ?? []);
}
