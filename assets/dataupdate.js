// dataupdate.js — 浏览器内“联网更新数据”能力（不依赖 GitHub Pages / Actions）
// 让用户在本地双击打开的页面里也能分批次拉取最新（含补全缺口）数据，并下载到本地持久化。
window.SSQ = window.SSQ || {};
(function (S) {
  // ---- 归一化 / 解析 ----
  function normIssue(s) {
    s = String(s).trim();
    if (/^\d{5}$/.test(s)) return "20" + s;
    return s;
  }

  // 解析 samuai0410 全量 JSON（含 2003-至今、一/二等奖金额）
  function parseSamuai(json) {
    const arr = json.draws || json.data || (Array.isArray(json) ? json : null);
    if (!arr) throw new Error("结构未知：未找到 draws/data 数组");
    const out = {};
    for (const d of arr) {
      const issue = normIssue(d.issue);
      const p = d.prizes || [];
      const p1 = p.find((x) => x.level === 1) || {};
      const p2 = p.find((x) => x.level === 2) || {};
      out[issue] = {
        issue,
        date: d.date || "",
        red: (d.redBalls || d.red_balls || []).map(Number),
        blue: Number(d.blueBall ?? d.blue_ball ?? 0),
        sales: Number(d.salesAmount ?? d.sales ?? 0) || null,
        pool: Number(d.poolAmount ?? d.pool ?? 0) || null,
        prize1: { count: Number(p1.count ?? 0) || null, amount: Number(p1.amount ?? 0) || null },
        prize2: { count: Number(p2.count ?? 0) || null, amount: Number(p2.amount ?? 0) || null },
        prize3: null, // 三等奖固定 ¥3000，由规则计算
      };
    }
    return out;
  }

  // 解析中彩网官方接口单条（字段兼容 code/issue/expect、red 字符串或数组、prizegrades）
  // 注意：官方 typemoney 形如 "8455559（含派奖1250000）"，需提取数字前缀。
  function num(v) {
    if (v == null || v === "") return null;
    const m = String(v).match(/^[0-9.]+/);
    return m ? Number(m[0]) : null;
  }
  function parseCwl(d) {
    if (!d) return null;
    const issue = normIssue(d.code ?? d.issue ?? d.expect ?? "");
    if (!issue) return null;
    const red = typeof d.red === "string"
      ? d.red.split(",").map((s) => parseInt(s.trim(), 10))
      : (d.red || []).map(Number);
    const blue = Number(typeof d.blue === "string" ? d.blue.trim() : d.blue);
    const pg = d.prizegrades || d.prizeGrades || [];
    const f = (t) => pg.find((x) => (x.type ?? x.level) === t) || {};
    const p1 = f(1), p2 = f(2);
return {
      issue,
      date: d.date ? d.date.replace(/\(.*?\)/g, "").replace(/\s/g, "").trim() : "",
      red,
      blue,
      sales: d.saleamount != null ? Number(d.saleamount) : (d.sales != null ? Number(d.sales) : null),
      pool: d.poolmoney != null ? Number(d.poolmoney) : (d.pool != null ? Number(d.pool) : null),
      prize1: { count: num(p1.typenum ?? p1.count), amount: num(p1.typemoney ?? p1.amount) },
      prize2: { count: num(p2.typenum ?? p2.count), amount: num(p2.typemoney ?? p2.amount) },
      prize3: null,
    };
  }

  // ---- 缺口检测（按开奖日期，间隔>30天视为缺口） ----
  function addDays(dateStr, n) {
    const t = Date.parse(dateStr) + n * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function findGaps(records) {
    const sorted = records.slice().sort((a, b) => a.date.localeCompare(b.date));
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const d1 = Date.parse(sorted[i - 1].date), d2 = Date.parse(sorted[i].date);
      if (isNaN(d1) || isNaN(d2)) continue;
      const days = (d2 - d1) / 86400000;
      if (days > 30) {
        gaps.push({ start: addDays(sorted[i - 1].date, 1), end: addDays(sorted[i].date, -1) });
      }
    }
    return gaps;
  }

  // ---- 主源：开源镜像（一次性全量，CORS 友好，含完整历史含缺口） ----
  async function fetchLatest() {
    const primaries = [
      "https://cdn.jsdelivr.net/gh/samuai0410/lottery@main/data/ssq_history.json",
      "https://gcore.jsdelivr.net/gh/samuai0410/lottery@main/data/ssq_history.json",
      "https://raw.githubusercontent.com/samuai0410/lottery/main/data/ssq_history.json",
    ];
    let records = {};
    let source = "";
    for (const u of primaries) {
      try {
        const res = await fetch(u, { headers: { "User-Agent": "ssq-data-update" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        const p = parseSamuai(json);
        if (Object.keys(p).length) { records = p; source = u; break; }
      } catch (e) { /* 尝试下一个源 */ }
    }
    if (!Object.keys(records).length) {
      try {
        records = await fetchFallback();
        source = "fallback: zhcw(2003-2018,含奖金) + sinyu1012(近期)；2018-2025 缺口可能仍存在";
      } catch (e) {
        throw new Error("所有数据源均不可达，请检查网络后重试，或改用「node scripts/fetch-data.mjs」在本地更新。");
      }
    }
    return toObj(records, source);
  }

  // 兜底：中彩网历史 txt（2003-2018，含奖金）+ 近期镜像（号码/日期）
  async function fetchFallback() {
    const api = (repo, path) =>
      fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { headers: { "User-Agent": "ssq-data-update" } })
        .then((r) => r.json())
        .then((j) => {
          if (!j.content) throw new Error(`${repo}/${path} 无 content（可能超 1MB）`);
          return atob(j.content);
        });
    const zhcwText = await api("UnstoppableL/lotterydata", "lot_zhcw_ssq.txt");
    const sinyuText = await api("sinyu1012/Double-Color-Ball-AI", "data/lottery_history.json");
    const out = {};
    for (const line of zhcwText.split("\n")) {
      const p = line.split(",");
      if (p.length < 18) continue;
      const issue = normIssue(p[2]);
      out[issue] = {
        issue, date: p[1].trim(),
        red: [3, 4, 5, 6, 7, 8].map((i) => parseInt(p[i], 10)),
        blue: parseInt(p[9], 10),
        sales: parseInt(p[10], 10) || null, pool: parseInt(p[17], 10) || null,
        prize1: { count: parseInt(p[11], 10) || null, amount: parseInt(p[12], 10) || null },
        prize2: { count: parseInt(p[13], 10) || null, amount: parseInt(p[14], 10) || null },
        prize3: { count: parseInt(p[15], 10) || null, amount: parseInt(p[16], 10) || null },
      };
    }
    const sin = JSON.parse(sinyuText).data || [];
    for (const it of sin) {
      const issue = normIssue(it.period);
      if (out[issue] && out[issue].date) continue;
      out[issue] = {
        issue, date: it.date || "",
        red: (it.red_balls || []).map(Number), blue: Number(it.blue_ball),
        sales: null, pool: null, prize1: null, prize2: null, prize3: null,
      };
    }
    return out;
  }

  // 浏览器内无法跨域访问中彩网官方接口（无 CORS 头），故浏览器更新统一走“开源镜像”
  // （samuai0410/lottery，含 2003-2025 完整历史与奖级金额，raw/jsdelivr 均带 CORS:*）。
  // 如需官方权威源 + 最新一期(2026+)，请在本机终端运行 node scripts/fetch-data.mjs。

  function toObj(map, source) {
    const items = Object.values(map).sort((a, b) => a.issue.localeCompare(b.issue));
    return {
      meta: {
        generatedAt: new Date().toISOString(),
        source,
        totalIssues: items.length,
        latestIssue: items.length ? items[items.length - 1].issue : "",
        note: "三等奖固定 ¥3000，由规则计算，不在数据中存储；一/二等奖为浮动，取自数据。",
      },
      data: items,
    };
  }

  // 分批次/缺口联网更新：检测缺口与缺失奖级字段，用镜像全量补全，与现有数据合并
  async function updateBatched(onLog) {
    onLog = onLog || (() => {});
    const base = (window.SSQ_DATA && window.SSQ_DATA.data) ? window.SSQ_DATA.data.slice() : [];
    const map = {};
    base.forEach((r) => { map[r.issue] = r; });
    const gaps = findGaps(base);
    onLog(`当前数据 ${base.length} 期，检测到 ${gaps.length} 处日期缺口：` +
      (gaps.map((g) => g.start + "~" + g.end).join("；") || "无"));

    onLog("浏览器更新使用开源镜像（CORS 友好，含 2003-2025 完整历史与奖级金额）…");
    let added = 0, filled = 0, usedMirror = false;
    try {
      const full = await fetchLatest();
      full.data.forEach((r) => {
        if (!map[r.issue]) { map[r.issue] = r; added++; }
        else {
          // 补官方/本地缺失的奖级金额等字段
          const m = map[r.issue];
          if ((!m.prize1 || m.prize1.amount == null) && r.prize1 && r.prize1.amount != null) { m.prize1 = r.prize1; filled++; }
          if ((!m.prize2 || m.prize2.amount == null) && r.prize2 && r.prize2.amount != null) m.prize2 = r.prize2;
        }
      });
      usedMirror = true;
      onLog(`镜像补全：新增 ${added} 期，补全缺失奖级字段 ${filled} 处`);
    } catch (e) {
      onLog("镜像补全失败：" + e.message + "（可改用本机 node scripts/fetch-data.mjs）");
    }

    const items = Object.values(map).sort((a, b) => a.issue.localeCompare(b.issue));
    const gapsRemaining = findGaps(items).length;
    const obj = toObj(map, usedMirror
      ? "samuai0410镜像(全量) + 已有数据"
      : "仅已有数据（镜像不可达）");
    obj.added = added;
    obj.filled = filled;
    obj.gapsRemaining = gapsRemaining;
    return obj;
  }

  // ---- 下载更新后的数据文件（kind: 'js' 离线版 / 'json' 在线版备份） ----
  function triggerDownload(content, type, filename) {
    const blob = new Blob([content], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function download(obj, kind) {
    if (kind === "json") {
      triggerDownload(JSON.stringify(obj), "application/json", "ssq.json");
    } else {
      triggerDownload("window.SSQ_DATA=" + JSON.stringify(obj) + ";", "text/javascript", "ssq.js");
    }
  }

  S.update = { fetchLatest, fetchFallback, parseSamuai, parseCwl, updateBatched, download, findGaps };
})(window.SSQ);
