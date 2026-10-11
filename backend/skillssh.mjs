// skills.sh 市场数据：排行榜抓取与搜索接口。
// 站点结构变化时返回空列表而不是抛错，由调用方提示用户稍后再试。
const TIMEOUT_MS = 15000;
const MARKER = '<script id="__NEXT_DATA__" type="application/json">';

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "skills-manager" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`skills.sh 请求失败（HTTP ${response.status}）`);
  return response.text();
}

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
    skills.push({ id, skill_id: skillId, name: String(item.name ?? "") || skillId, source, installs: Number.isFinite(installs) ? installs : 0 });
  }
  return skills;
}

function parseNextData(html) {
  const start = html.indexOf(MARKER);
  if (start < 0) return [];
  const end = html.indexOf("</script>", start);
  if (end < 0) return [];
  try {
    const data = JSON.parse(html.slice(start + MARKER.length, end));
    const props = data?.props?.pageProps ?? {};
    return normalize(props.initialSkills ?? props.skills ?? props.items);
  } catch { return []; }
}

// 兜底：RSC 流水或内联 JSON 中的技能对象（处理转义引号变体）。
function parseEmbedded(html) {
  const text = html.replace(/\\"/g, '"').replace(/\\+/g, "\\");
  const pattern = /\{"source":"([^"\s]+)","(?:skill_id|skillId)":"([^"\s]+)"(?:,"name":"([^"]*)")?[^{}]*?(?:"installs":(\d+))?[^{}]*\}/g;
  const items = [];
  for (const match of text.matchAll(pattern)) {
    items.push({ source: match[1], skill_id: match[2], name: match[3] ?? "", installs: Number(match[4] ?? 0) });
  }
  return normalize(items);
}

function parseSkills(html) {
  return parseNextData(html).length ? parseNextData(html) : parseEmbedded(html);
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
