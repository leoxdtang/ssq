#!/usr/bin/env node
/**
 * fetch-data.mjs — 双色球数据抓取与规范化（生产用，可在 GitHub Actions 或本机运行）
 *
 * 数据源（按优先级）：
 *   1) samuai0410/lottery 的 data/ssq_history.json（raw.githubusercontent，覆盖 2003-至今，
 *      含开奖日期、销售额、奖池、一/二等奖注数与金额）—— 全量且每日更新。
 *   2) 兜底：UnstoppableL/lotterydata 的 lot_zhcw_ssq.txt（2003-2018，含奖金）
 *      + sinyu1012/Double-Color-Ball-AI 的 data/lottery_history.json（近期，含号码+日期）。
 *
 * 输出：../data/ssq.json（规范模型，按期号升序，附 meta）。
 * 仅在数据变化时由调用方决定是否提交。
 */
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "data", "ssq.json");

const UA = { "User-Agent": "ssq-data-fetch" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normIssue(s) {
  s = String(s).trim();
  // 5 位 YYNNN -> 7 位 YYYYNNN
  if (/^\d{5}$/.test(s)) return "20" + s;
  return s;
}

async function httpGet(url, as = "text") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return as === "json" ? res.json() : res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 解析 samuai0410 全量 JSON
function parseSamuai(json) {
  const arr = json.draws || json.data || (Array.isArray(json) ? json : null);
  if (!arr) throw new Error("samuai010 结构未知：未找到 draws/data 数组");
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
      prize3: null, // 三等奖固定 3000，由规则计算
    };
  }
  return out;
}

// 解析中彩网官方接口单条
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

// 官方接口按“分批次”拉取（Node 端无跨域限制）。按年分批（issueStart/issueEnd），逐年分页。
// 已验证可用：https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice
// 注意：官方接口仅支持回看约 10 年（2015 年起），更早的年份由本地已提交数据/镜像兜底。
const START_YEAR = 2015;
async function fetchCwlBatched() {
  const headers = { "User-Agent": "Mozilla/5.0" };
  const base = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&systemType=PC";
  const out = {};
  const thisYear = new Date().getFullYear();
  for (let y = START_YEAR; y <= thisYear; y++) {
    let page = 1;
    while (page <= 30) {
      const url = `${base}&issueStart=${y}001&issueEnd=${y}999&pageNo=${page}&pageSize=300`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(url, { headers, signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = await res.json();
        if (json.state !== 0) throw new Error("state=" + json.state + " " + (json.message || ""));
        const list = json.result || [];
        if (!list.length) break;
        for (const d of list) { const r = parseCwl(d); if (r) out[r.issue] = r; }
        if (list.length < 300) break;
        page++;
      } catch (e) {
        console.warn(`    ${y} 年官方接口失败：${e.message}`);
        throw e;
      }
    }
    console.log(`  ${y} 年：累计 ${Object.keys(out).length} 期`);
    await sleep(300);
  }
  if (!Object.keys(out).length) throw new Error("官方接口未返回任何数据");
  return out;
}

// 兜底：zhcw 全量 + sinyu1012 近期（通过 GitHub API 取 base64）
async function fetchFallback() {
  const api = (repo, path) =>
    httpGet(`https://api.github.com/repos/${repo}/contents/${path}`, "json").then((j) => {
      if (!j.content) throw new Error(`${repo}/${path} 无 content（可能超 1MB）`);
      return Buffer.from(j.content, "base64").toString("utf-8");
    });

  const zhcwText = await api("UnstoppableL/lotterydata", "lot_zhcw_ssq.txt");
  const sinyuText = await api("sinyu1012/Double-Color-Ball-AI", "data/lottery_history.json");

  const out = {};
  for (const line of zhcwText.split("\n")) {
    const p = line.split(",");
    if (p.length < 18) continue;
    const issue = normIssue(p[2]);
    out[issue] = {
      issue,
      date: p[1].trim(),
      red: [3, 4, 5, 6, 7, 8].map((i) => parseInt(p[i], 10)),
      blue: parseInt(p[9], 10),
      sales: parseInt(p[10], 10) || null,
      pool: parseInt(p[17], 10) || null,
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
      issue,
      date: it.date || "",
      red: (it.red_balls || []).map(Number),
      blue: Number(it.blue_ball),
      sales: null,
      pool: null,
      prize1: null,
      prize2: null,
      prize3: null,
    };
  }
  return out;
}

async function main() {
  // 基础数据：优先用已提交的本地文件（含官方接口覆盖不到的早年期 2003-2014 等）
  let records = {};
  try {
    const existing = JSON.parse(readFileSync(OUT, "utf-8"));
    for (const r of existing.data) records[r.issue] = r;
    console.log(`[0/3] 已加载本地基础数据 ${Object.keys(records).length} 期`);
  } catch {
    console.log("[0/3] 无本地基础数据，将从零开始");
  }
  let source = "本地基础数据";
  try {
    console.log(`[1/3] 官方接口（中彩网）分批次拉取 ${START_YEAR}-至今 ...`);
    const official = await fetchCwlBatched();
    let added = 0;
    for (const k of Object.keys(official)) if (!records[k]) added++;
    Object.assign(records, official); // 官方为权威，覆盖同名期号
    source = `cwl.gov.cn 官方接口(${START_YEAR}-至今) + 本地早年期`;
    console.log(`  官方成功 ${Object.keys(official).length} 期（新增 ${added} 期），合并后 ${Object.keys(records).length} 期`);
  } catch (e) {
    console.warn("  官方接口失败：", e.message);
    try {
      console.log("[2/3] 尝试镜像源 samuai0410 ssq_history.json ...");
      const json = await httpGet(
        "https://raw.githubusercontent.com/samuai0410/lottery/main/data/ssq_history.json",
        "json"
      );
      const mirror = parseSamuai(json);
      let added = 0;
      for (const k of Object.keys(mirror)) if (!records[k]) { records[k] = mirror[k]; added++; }
      source = `本地基础 + 镜像 samuai0410 (新增 ${added} 期)`;
      console.log(`  镜像成功：补缺 ${added} 期，合并后 ${Object.keys(records).length} 期`);
    } catch (e2) {
      console.warn("  镜像失败：", e2.message);
      console.log("[3/3] 使用兜底源（zhcw + sinyu1012）...");
      const fb = await fetchFallback();
      let added = 0;
      for (const k of Object.keys(fb)) if (!records[k]) { records[k] = fb[k]; added++; }
      source = `本地基础 + 兜底 zhcw/sinyu1012 (新增 ${added} 期)`;
      console.log(`  兜底成功：补缺 ${added} 期，合并后 ${Object.keys(records).length} 期`);
    }
  }

  // [4/4] 官方接口仅覆盖 ~10 年（2015-至今），更早年份（2003-2014）用镜像补全奖级金额等字段。
  // 镜像(raw.githubusercontent) 在用户本机通常可达（在本沙箱可能被墙，属正常）。
  let mirrorFill = 0;
  try {
    console.log("[4/4] 镜像源补全早年期(2003-2014)缺失字段 ...");
    const json = await httpGet(
      "https://raw.githubusercontent.com/samuai0410/lottery/main/data/ssq_history.json",
      "json"
    );
    const mirror = parseSamuai(json);
    for (const k of Object.keys(mirror)) {
      const base = records[k];
      const m = mirror[k];
      if (!base) { records[k] = m; mirrorFill++; continue; }
      // 补全官方/本地缺失的标量字段
      for (const f of ["sales", "pool"]) {
        if (base[f] == null && m[f] != null) { base[f] = m[f]; mirrorFill++; }
      }
      // 补全奖级对象（prize1/prize2/prize3）中缺失的 count/amount
      for (const pf of ["prize1", "prize2", "prize3"]) {
        if (m[pf] && typeof m[pf] === "object") {
          if (!base[pf] || typeof base[pf] !== "object") {
            base[pf] = m[pf]; mirrorFill++;
          } else {
            for (const sub of ["count", "amount"]) {
              if (base[pf][sub] == null && m[pf][sub] != null) { base[pf][sub] = m[pf][sub]; mirrorFill++; }
            }
          }
        }
      }
    }
    if (mirrorFill) console.log(`  镜像补全字段 ${mirrorFill} 处`);
    else console.log("  早年期字段已完整，无需补全");
  } catch (e) {
    console.warn("  镜像补全跳过（本环境不可达或无需）：", e.message);
  }

  const items = Object.values(records).sort((a, b) => a.issue.localeCompare(b.issue));
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      source,
      totalIssues: items.length,
      latestIssue: items.length ? items[items.length - 1].issue : "",
      note: "三等奖固定 ¥3000，由规则计算，不在数据中存储；一/二等奖为浮动，取自数据。",
    },
    data: items,
  };
  writeFileSync(OUT, JSON.stringify(out), "utf-8");
  console.log(`已写出 ${OUT}：共 ${items.length} 期，区间 ${items[0]?.issue} ~ ${items[items.length - 1]?.issue}`);
  // 同时生成内嵌数据文件（data/ssq.js），供 file:// 双击直接打开（浏览器禁止 file:// 下 fetch 本地文件）
  const OUT_JS = join(ROOT, "data", "ssq.js");
  writeFileSync(OUT_JS, "window.SSQ_DATA=" + JSON.stringify(out) + ";", "utf-8");
  console.log(`已写出 ${OUT_JS}（内嵌全局，支持离线双击打开）`);
}

main().catch((e) => {
  console.error("fetch-data 失败：", e);
  process.exit(1);
});
