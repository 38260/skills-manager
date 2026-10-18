import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { git as runGit } from "./library.mjs";
import { files, hashDirectory, inside } from "./files.mjs";

// Git 备份（APP-04）：技能目录即 Git 仓库（skills/.skills-manager 元数据一并入库，
// DB 与密钥在仓库外）。合并引擎为系统 git（merge_engine=system 语义），冲突按技能
// 目录粒度记录到 pending_conflicts，由用户选择保留本地／采用远端／两份保留。
const SKILL_SIZE_LIMIT_BYTES = 100 * 1024 * 1024;
const REPO_SIZE_WARN_BYTES = 1024 * 1024 * 1024;
const GITHUB_API = "https://api.github.com";
const OAUTH_CLIENT_ID = "Ov23li4a3SMdhIiKo7IE";

function pad(value, width = 2) { return String(value).padStart(width, "0"); }
function timestampLabel(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function backupCommands(store, emit) {
  const repoDir = () => store.skillsDirectory;
  const isRepo = () => fs.existsSync(path.join(repoDir(), ".git"));
  const cacheDir = () => { const dir = path.join(store.directory, "cache"); fs.mkdirSync(dir, { recursive: true }); return dir; };
  const deviceName = () => store.getSetting("backup_device_name") || os.hostname();

  async function git(args, hooks = {}) {
    return runGit(repoDir(), args, hooks);
  }

  async function tryGit(args) {
    try { return await git(args); } catch (error) { if (process.env.SKILLS_MANAGER_DEBUG) console.error(`[backup:tryGit] ${args.join(" ")} → ${error.message}`); return null; }
  }

  async function ensureGitIdentity() {
    if (!await tryGit(["config", "user.email"])) {
      await git(["config", "user.email", "skills-manager@local"]);
      await git(["config", "user.name", deviceName()]);
    }
  }

  function ensureGitignore() {
    const filename = path.join(repoDir(), ".gitignore");
    const base = [".DS_Store", "Thumbs.db", "__pycache__/", "*.pyc"];
    const begin = "# skills-manager: oversized skills excluded from backup (auto-managed)";
    const end = "# skills-manager: end oversized skills";
    let existing = "";
    try { existing = fs.readFileSync(filename, "utf8"); } catch {}
    let content = existing;
    for (const line of base) if (!content.split(/\r?\n/).includes(line)) content = content ? `${content.replace(/\s*$/, "\n")}${line}\n` : `${line}\n`;
    if (!content.includes(begin)) content = `${content.replace(/\s*$/, "\n")}${begin}\n${end}\n`;
    if (content !== existing) fs.writeFileSync(filename, content);
  }

  async function remoteUrl() {
    return isRepo() ? tryGit(["remote", "get-url", "origin"]) : null;
  }

  function credentialKey(url) { return `credential:${url}`; }
  function attachCredential(url) {
    const credential = store.getSetting(credentialKey(url));
    return credential ? url.replace("https://", `https://x-access-token:${credential}@`) : url;
  }

  async function commit(message) {
    ensureGitignore();
    try { await git(["add", "-A"]); }
    catch { throw new Error("not a git repository: 备份仓库不可用"); }
    const changes = await tryGit(["status", "--porcelain"]);
    if (!changes || !changes.trim()) return false;
    await ensureGitIdentity();
    try { await git(["commit", "-m", String(message ?? "备份")]); }
    catch (error) { throw new Error(redactMessage(error.message)); }
    return true;
  }

  function redactMessage(message) {
    return String(message).replace(/x-access-token:[^@\s]+@/g, "***@").replace(/gh[pousr]_[A-Za-z0-9_]+/g, "***");
  }

  async function createSnapshotTag() {
    // HEAD 上已有快照 tag 时复用，避免重复历史条目。
    const existing = await tryGit(["tag", "--points-at", "HEAD", "--list", "sm-v-*", "--sort=-creatordate"]);
    const reuse = existing?.split(/\r?\n/).find(line => line.trim());
    if (reuse) return reuse.trim();
    const shortSha = (await git(["rev-parse", "--short", "HEAD"])).trim();
    let tag = `sm-v-${timestampLabel()}-${shortSha}`;
    if (await tryGit(["rev-parse", "-q", "--verify", `refs/tags/${tag}`])) {
      tag = `sm-v-${timestampLabel()}-${pad(new Date().getMilliseconds(), 3)}-${shortSha}`;
    }
    await git(["tag", tag]);
    return tag;
  }

  async function upstreamInfo() {
    const remote = await remoteUrl();
    if (!remote) return { remote: null, health: "no_remote", upstream: null, ahead: 0, behind: 0 };
    const branch = (await tryGit(["rev-parse", "--abbrev-ref", "HEAD"]))?.trim();
    if (!branch || branch === "HEAD") return { remote, health: "detached", upstream: null, ahead: 0, behind: 0 };
    const remoteBranch = `origin/${branch}`;
    if (!await tryGit(["rev-parse", "-q", "--verify", remoteBranch])) return { remote, health: "no_upstream", upstream: null, ahead: 0, behind: 0 };
    const unrelated = !(await tryGit(["merge-base", "HEAD", remoteBranch]));
    if (unrelated) return { remote, health: "unrelated_histories", upstream: remoteBranch, ahead: 0, behind: 0 };
    const counts = (await git(["rev-list", "--left-right", "--count", `${remoteBranch}...HEAD`])).split(/\s+/);
    return { remote, health: "healthy", upstream: remoteBranch, behind: Number(counts[0]) || 0, ahead: Number(counts[1]) || 0 };
  }

  async function fetchRemote() {
    const remote = await remoteUrl();
    if (!remote) return;
    await git(["fetch", "origin", "--prune"]);
  }

  async function changedSkillCount() {
    const status = await tryGit(["status", "--porcelain"]);
    if (!status?.trim()) return { hasChanges: false, count: 0 };
    const skills = new Set();
    let others = 0;
    for (const line of status.split(/\r?\n/)) {
      const entry = line.slice(3).trim().replace(/^"|"$/g, "");
      if (!entry) continue;
      if (entry.startsWith(".gitignore")) { others++; continue; }
      const first = entry.split("/")[0];
      if (first === ".skills-manager") { others++; continue; }
      skills.add(first);
    }
    return { hasChanges: true, count: skills.size + others };
  }

  async function status() {
    if (!isRepo()) {
      return { is_repo: false, remote_url: null, branch: null, has_changes: false, changed_skill_count: 0,
        ahead: 0, behind: 0, last_commit: null, last_commit_time: null, current_snapshot_tag: null,
        restored_from_tag: null, upstream_health: "no_remote" };
    }
    const info = await upstreamInfo();
    const changes = await changedSkillCount();
    const last = await tryGit(["log", "-1", "--format=%s%n%cI"]);
    const [lastCommit, lastTime] = last ? last.split("\n") : [];
    const snapshot = await tryGit(["describe", "--tags", "--match", "sm-v-*", "--abbrev=0"]);
    return { is_repo: true, remote_url: info.remote, branch: info.health === "detached" ? null : info.health === "no_remote" ? null : (await tryGit(["rev-parse", "--abbrev-ref", "HEAD"]))?.trim() ?? null,
      has_changes: changes.hasChanges, changed_skill_count: changes.count,
      ahead: info.ahead, behind: info.behind, last_commit: lastCommit ?? null, last_commit_time: lastTime ?? null,
      current_snapshot_tag: snapshot ?? null, restored_from_tag: null, upstream_health: info.health };
  }

  async function ensureRepo() {
    if (isRepo()) return;
    try { await git(["init", "-b", "main"]); }
    catch { await git(["init"]); await tryGit(["symbolic-ref", "HEAD", "refs/heads/main"]); }
    ensureGitignore();
    await commit("初始化技能库备份");
  }

  // 记录本地与远端有差异的技能目录到 pending_conflicts。
  async function recordConflicts(theirsRef) {
    // 记录具体提交而不是 upstream 引用：引用会随下一次 fetch 移动，等用户点「解决冲突」时
    // 取到的可能已经不是当初检测到的那个版本（副本目录名也会变成 "-origin/" 这种）。
    const theirsCommit = (await tryGit(["rev-parse", "-q", "--verify", `${theirsRef}^{commit}`])) ?? theirsRef;
    // 与 extractTheirs 同理：默认输出会把含中文的路径写成 "\"shared/\350\265\204..."，
    // 按 "/" 取首段会得到 `"shared` 这种伪目录名，冲突项因此对不上真实技能。
    const diff = await tryGit(["-c", "core.quotepath=false", "diff", "-z", "--name-only", "HEAD", theirsCommit, "--", "."]);
    if (!diff) return;
    const dirs = new Set();
    for (const entry of diff.split("\0")) {
      if (!entry || entry === ".gitignore") continue;
      const dir = entry.split("/")[0];
      // 点开头的是仓库内元数据（.git*、.skills-manager 等），不对应可恢复的技能目录。
      if (dir.startsWith(".")) continue;
      dirs.add(dir);
    }
    for (const dir of dirs) {
      const skillId = store.matchSkill(dir) ?? dir;
      store.run("INSERT INTO pending_conflicts(skill_id,theirs_commit,theirs_path,detected_at) VALUES(?,?,?,?) ON CONFLICT(skill_id) DO UPDATE SET theirs_commit=excluded.theirs_commit,detected_at=excluded.detected_at",
        skillId, theirsCommit, null, Date.now());
    }
  }

  async function mergeUpstream() {
    await fetchRemote();
    const info = await upstreamInfo();
    if (info.health === "detached" || info.health === "unrelated_histories") {
      throw new Error(redactMessage(`${info.health === "unrelated_histories" ? "unrelated histories: 远端历史与本地不相关，请使用恢复流程" : "detached HEAD: 请先切回分支"}`));
    }
    if (!info.upstream || info.behind === 0) return null;
    try {
      await git(["merge", info.upstream, "--no-edit"]);
    } catch (error) {
      // 合并冲突时 git 以退出码 1 结束且输出在 stdout，用 MERGE_HEAD 判断进入冲突处理。
      if (fs.existsSync(path.join(repoDir(), ".git", "MERGE_HEAD"))) {
        await tryGit(["merge", "--abort"]);
        await recordConflicts(info.upstream);
        throw Object.assign(new Error(redactMessage("SYNC_CONFLICT: 备份在两台设备上都有改动（pending on both devices），请解决冲突后继续")), { code: "CONFLICT" });
      }
      throw new Error(redactMessage(error.message));
    }
    const conflicts = store.all("SELECT * FROM pending_conflicts").length;
    return { engine: "system", up_to_date: false, fast_forward: info.ahead === 0, updated: [], kept_local: [],
      new_conflicts: [], pending_total: conflicts, old_client_warning: null, legacy_fallback: true };
  }

  // `git show` 取文件内容：stdout 按 Buffer 直接落盘。走字符串会把非 UTF-8 字节替换成
  // U+FFFD，图片／压缩包这类二进制文件被还原成坏文件。
  function gitBuffer(args, limit = 256 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      execFile("git", ["-C", repoDir(), ...args], {
        encoding: "buffer", windowsHide: true, maxBuffer: limit,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      }, (error, stdout, stderr) => {
        if (error) {
          const detail = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || "");
          reject(new Error(redactMessage(detail.trim() || `git 退出码 ${error.code ?? 1}`)));
          return;
        }
        resolve(stdout);
      });
    });
  }

  // 「两份都保留」：把远端版本的整个技能目录写到目标目录。
  // ls-tree 必须用 -z：默认输出会把中文与空格路径转义成 "\346\212\200..." 形态，
  // 按行切分后再去 show 这些路径一律取不到内容。分隔符是 NUL，按 NUL 切即可。
  async function extractTheirs(theirsCommit, dirRel, destination) {
    const listing = await runGit(repoDir(), ["-c", "core.quotepath=false", "ls-tree", "-r", "-z", "--name-only", theirsCommit, "--", dirRel]);
    for (const name of listing.split("\0")) {
      if (!name) continue;
      const target = inside(destination, path.relative(dirRel, name));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, await gitBuffer(["show", `${theirsCommit}:${name}`]));
    }
  }

  return {
    git_backup_status: { call: () => status() },
    git_backup_fetch: { call: async () => { await fetchRemote().catch(error => { throw new Error(redactMessage(error.message)); }); } },
    git_backup_init: { call: async () => { await ensureRepo(); }, mutating: true },
    git_backup_commit: { call: async args => { await commit(args.message); }, mutating: true },
    git_backup_push: { call: async () => {
      const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      await git(["push", "-u", "origin", branch]).catch(error => { throw new Error(redactMessage(error.message)); });
    } },
    git_backup_pull: { call: async () => (await mergeUpstream()) ?? { engine: "system", up_to_date: true, fast_forward: false, updated: [], kept_local: [], new_conflicts: [], pending_total: 0, old_client_warning: null, legacy_fallback: true } },
    git_backup_sync: { call: async args => {
      if (!isRepo()) throw new Error("not a git repository: 备份尚未初始化");
      const committed = await commit(args.message);
      const merge = await mergeUpstream();
      if (merge) await commit("合并远端备份改动");
      let pushed = false;
      const remote = await remoteUrl();
      if (remote) {
        const branch = (await git(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
        try { await git(["push", "-u", "origin", branch]); pushed = true; }
        catch (error) { throw new Error(redactMessage(error.message)); }
      }
      const snapshotTag = await createSnapshotTag();
      return { committed, merge, pushed, snapshot_tag: snapshotTag };
    }, mutating: true },
    git_backup_create_snapshot: { call: async () => { await commit("快照"); return createSnapshotTag(); }, mutating: true },
    git_backup_list_versions: { call: async args => {
      const limit = Math.max(1, Number(args.limit) || 50);
      const refs = await tryGitSync(["for-each-ref", "refs/tags",
        "--format=%(refname:short)%09%(*objectname)%09%(objectname)%09%(committerdate:iso-strict)%09%(*subject)%09%(subject)"]);
      const versions = [];
      for (const line of refs.split(/\r?\n/)) {
        const [tag, taggedCommit, commit, date, taggedSubject, subject] = line.split("\t");
        if (!tag?.startsWith("sm-v-")) continue;
        versions.push({ tag, commit: taggedCommit || commit || tag, message: subject || "", committed_at: date || "", author: taggedSubject || subject || "" });
      }
      // 同秒创建的快照用提交拓扑序保证确定性排序（新提交在前）。
      const topo = ((await tryGitSync(["log", "--all", "--topo-order", "--format=%H"])) || "").split(/\r?\n/).filter(Boolean);
      const topoIndex = new Map(topo.map((sha, index) => [sha, index]));
      versions.sort((a, b) => {
        const dateDiff = (Date.parse(b.committed_at) || 0) - (Date.parse(a.committed_at) || 0);
        if (dateDiff !== 0) return dateDiff;
        return (topoIndex.get(a.commit) ?? Number.MAX_SAFE_INTEGER) - (topoIndex.get(b.commit) ?? Number.MAX_SAFE_INTEGER);
      });
      return versions.slice(0, limit);
    } },
    git_backup_restore_version: { call: async args => {
      if (!isRepo()) throw new Error("not a git repository");
      const tag = String(args.tag ?? "");
      if (!await tryGit(["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`])) throw new Error(`备份版本不存在：${tag}`);
      await commit("恢复前自动快照");
      const safetyTag = await createSnapshotTag();
      await git(["reset", "--hard", tag]);
      emit?.("app-files-changed", null);
      return safetyTag;
    }, mutating: true },
    git_backup_size_report: { call: () => {
      let total = 0;
      const skillLimit = SKILL_SIZE_LIMIT_BYTES;
      const oversized = [];
      let rootEntries = [];
      try { rootEntries = fs.readdirSync(repoDir(), { withFileTypes: true }); } catch {}
      for (const entry of rootEntries) {
        if (!entry.isDirectory() || entry.name === ".git") continue;
        const full = path.join(repoDir(), entry.name);
        const size = files(full).reduce((sum, file) => sum + file.size, 0);
        if (entry.name === ".skills-manager") { total += size; continue; }
        total += size;
        if (size > skillLimit) {
          const ignored = fs.readFileSync(path.join(repoDir(), ".gitignore"), "utf8").includes(`/${entry.name}/`);
          oversized.push({ name: entry.name, bytes: size, excluded: ignored });
        }
      }
      return { total_bytes: total, oversized, skill_limit_bytes: skillLimit, repo_warn_bytes: REPO_SIZE_WARN_BYTES };
    } },
    git_backup_pending_conflicts: { call: () => store.all("SELECT * FROM pending_conflicts ORDER BY detected_at") },
    git_backup_resolve_conflict: { call: async args => {
      const record = store.get("SELECT * FROM pending_conflicts WHERE skill_id=?", args.skillId);
      if (!record) throw new Error("没有待解决的备份冲突");
      const skill = store.skills().find(item => item.id === args.skillId);
      const dirName = skill ? path.basename(skill.central_path) : args.skillId;
      await commit("冲突解决前自动快照");
      const safetyTag = await createSnapshotTag();
      const dirRel = dirName;
      // 用 ours 策略把远端历史接入本地（树保持本地版本），解决后分歧消除、可正常推送；
      // 之后按用户选择只调整该技能目录的内容。
      const alreadyMerged = await tryGit(["merge-base", "--is-ancestor", record.theirs_commit, "HEAD"]);
      if (!alreadyMerged) {
        try { await git(["merge", "-s", "ours", record.theirs_commit, "--no-edit"]); }
        catch (error) { throw new Error(redactMessage(error.message)); }
      }
      if (args.action === "use_remote") {
        await git(["checkout", record.theirs_commit, "--", dirRel]);
      } else if (args.action === "keep_both") {
        const target = path.join(repoDir(), `${dirName}-from-remote-${record.theirs_commit.slice(0, 7)}`);
        fs.mkdirSync(target, { recursive: true });
        await extractTheirs(record.theirs_commit, dirRel, target);
      } // keep_local：保持本地内容不变
      await commit(`解决备份冲突（${args.action}）：${dirName}`);
      store.run("DELETE FROM pending_conflicts WHERE skill_id=?", args.skillId);
      return safetyTag;
    }, mutating: true },
    git_backup_set_remote: { call: async args => {
      const url = String(args.url ?? "").trim();
      if (!url) throw new Error("远程仓库地址不能为空");
      await ensureRepo();
      await tryGit(["remote", "remove", "origin"]);
      await git(["remote", "add", "origin", attachCredential(url)]);
      return url;
    }, mutating: true },
    git_backup_remove_remote: { call: async () => { await tryGit(["remote", "remove", "origin"]); }, mutating: true },
    git_backup_sanitize_remote_url: { call: args => {
      const url = String(args.url ?? "").trim();
      const match = /^(https:\/\/)([^@/\s:]+):([^@/\s]+)@(.+)$/.exec(url);
      if (!match) return url;
      const [, scheme, , secret, rest] = match;
      const sanitized = `${scheme}${rest}`;
      store.setSetting(credentialKey(sanitized), secret);
      return sanitized;
    } },
    git_backup_migrate_credentials: { call: () => {
      const url = store.getSetting("git_backup_remote_url");
      if (!url) return null;
      const match = /^(https:\/\/)([^@/\s:]+):([^@/\s]+)@(.+)$/.exec(url);
      if (!match) return null;
      const sanitized = `${match[1]}${match[4]}`;
      store.setSetting(credentialKey(sanitized), match[3]);
      store.setSetting("git_backup_remote_url", sanitized);
      return sanitized;
    } },
    git_backup_clone: { call: async args => cloneInto(args, { keepOldGit: false }) },
    git_backup_reclone: { call: async args => reclone(args) },

    github_backup_connect: { call: args => githubConnect(String(args.token ?? ""), String(args.repoName ?? "")) },
    github_device_flow_start: { call: async () => {
      const response = await fetch("https://github.com/login/device/code", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: OAUTH_CLIENT_ID, scope: "repo" }), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("GITHUB_NETWORK: 无法连接 GitHub，请检查网络后重试");
      const data = await response.json();
      return { device_code: data.device_code, user_code: data.user_code, verification_uri: data.verification_uri, expires_in: data.expires_in, interval: data.interval };
    } },
    github_device_flow_poll: { call: async args => {
      const response = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ client_id: OAUTH_CLIENT_ID, device_code: args.deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("GITHUB_NETWORK: 无法连接 GitHub，请检查网络后重试");
      const data = await response.json();
      if (data.error === "authorization_pending") return { status: "pending", result: null };
      if (data.error === "slow_down") return { status: "slow_down", result: null };
      if (data.error === "expired_token" || data.error === "bad_verification_code") throw new Error("GITHUB_DEVICE_EXPIRED: 设备码已过期，请重新开始连接");
      if (data.error) throw new Error(`GITHUB_DEVICE_DENIED: ${data.error_description || data.error}`);
      const result = await githubConnect(data.access_token, String(args.repoName ?? ""));
      store.setSetting("github_auth_method", "oauth");
      return { status: "connected", result };
    } },
  };

  async function tryGitSync(args) {
    try { return await runGit(repoDir(), args); } catch { return ""; }
  }

  // 本地与远端同名技能内容不同的目录名列表；clone 前置检查。
  function localRemoteDiff(remoteRoot) {
    const diffs = [];
    let entries = [];
    try { entries = fs.readdirSync(repoDir(), { withFileTypes: true }); } catch {}
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "__pycache__") continue;
      const localDir = path.join(repoDir(), entry.name);
      const remoteDir = path.join(remoteRoot, entry.name);
      if (!["SKILL.md", "skill.md"].some(name => fs.existsSync(path.join(localDir, name)))) continue;
      if (fs.existsSync(path.join(remoteDir, "SKILL.md")) || fs.existsSync(path.join(remoteDir, "skill.md"))) {
        if (hashDirectory(localDir) !== hashDirectory(remoteDir)) diffs.push(entry.name);
      }
    }
    return diffs;
  }

  async function cloneInto(args, { keepOldGit }) {
    const url = String(args.url ?? "").trim();
    if (!url) throw new Error("远程仓库地址不能为空");
    const setAside = Array.isArray(args.setAside) ? args.setAside : null;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "skills-manager-clone-"));
    try {
      await runGit(temporary, ["clone", attachCredential(url), "repo"]).catch(error => { throw new Error(redactMessage(error.message)); });
      const remoteRepo = path.join(temporary, "repo");
      const diffs = localRemoteDiff(remoteRepo);
      if (diffs.length && !setAside) {
        throw new Error(`CLONE_LOCAL_DIFFERS: 本地与远端技能存在内容差异，请确认处理方式\ncopies:\n${diffs.join("\n")}`);
      }
      let keptDir = null;
      if (setAside) {
        const asideRoot = path.join(cacheDir(), `local-copies-${timestampLabel()}`);
        for (const name of diffs.filter(name => setAside.includes(name))) {
          const target = path.join(asideRoot, name);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.renameSync(path.join(repoDir(), name), target);
          keptDir = asideRoot;
        }
      }
      let keptGit = null;
      const gitDir = path.join(repoDir(), ".git");
      if (fs.existsSync(gitDir)) {
        keptGit = path.join(cacheDir(), keepOldGit ? `old-git-${timestampLabel()}` : `replaced-git-${timestampLabel()}`);
        fs.renameSync(gitDir, keptGit);
      }
      fs.renameSync(path.join(remoteRepo, ".git"), gitDir);
      // 远端内容覆盖工作区（保留仅本地存在的目录）。
      for (const entry of fs.readdirSync(remoteRepo, { withFileTypes: true })) {
        if (entry.name === ".git") continue;
        const source = path.join(remoteRepo, entry.name);
        const target = path.join(repoDir(), entry.name);
        if (entry.isDirectory()) {
          fs.mkdirSync(target, { recursive: true });
          for (const file of files(source)) {
            const destination = inside(target, file.relative);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(file.full, destination);
          }
        } else fs.copyFileSync(source, target);
      }
      emit?.("app-files-changed", null);
      return keepOldGit ? { kept_git: keptGit, local_copies: keptDir } : keptDir;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  async function reclone(args) {
    return cloneInto(args, { keepOldGit: true });
  }

  async function githubConnect(token, repoName) {
    const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    const api = async (pathname, options = {}) => {
      const response = await fetch(`${GITHUB_API}${pathname}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
      return response;
    };
    let user;
    try {
      const response = await api("/user");
      if (response.status === 401) throw new Error("GITHUB_TOKEN_INVALID: Token 无效或已过期");
      if (!response.ok) throw new Error("GITHUB_NETWORK: GitHub 请求失败");
      user = await response.json();
      if (!(response.headers.get("x-oauth-scopes") ?? "").split(",").map(item => item.trim()).includes("repo")) {
        throw new Error("GITHUB_SCOPE: Token 缺少 repo 权限，无法访问备份仓库");
      }
    } catch (error) {
      if (String(error.message).startsWith("GITHUB_")) throw error;
      throw new Error("GITHUB_NETWORK: 无法连接 GitHub，请检查网络后重试");
    }
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(repoName) || repoName === "." || repoName === "..") throw new Error("仓库名称只能包含字母、数字、-、_ 和 .");
    let repoCreated = false;
    let repo;
    let response = await api(`/repos/${user.login}/${repoName}`);
    if (response.status === 404) {
      response = await api("/user/repos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: repoName, private: true, auto_init: false }) });
      if (!response.ok && response.status !== 422) throw new Error("GITHUB_NETWORK: 创建备份仓库失败");
      repoCreated = response.status !== 422;
      response = await api(`/repos/${user.login}/${repoName}`);
      if (!response.ok) throw new Error("GITHUB_NETWORK: 备份仓库状态确认失败");
    } else if (!response.ok) {
      throw new Error("GITHUB_NETWORK: GitHub 请求失败");
    }
    repo = await response.json();
    const contents = await api(`/repos/${repo.full_name}/contents/`);
    let remoteHasContent = false;
    if (contents.ok) {
      const entries = await contents.json();
      remoteHasContent = Array.isArray(entries) && entries.length > 0;
    }
    const url = `https://github.com/${repo.full_name}.git`;
    store.setSetting(credentialKey(url), token);
    store.setSetting("github_auth_method", "pat");
    return { url, login: user.login, repo_created: repoCreated, repo_private: repo.private !== false, remote_has_content: remoteHasContent };
  }
}
