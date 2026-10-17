// 逻辑自测：在 Node 中加载纯逻辑模块并跑一次回测
global.window = {};
require("../assets/stats.js");
require("../assets/strategies.js");
require("../assets/backtest.js");
require("../assets/store.js");
const S = global.window.SSQ;
const fs = require("fs");
const path = require("path");

const json = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/ssq.json"), "utf-8"));
const records = json.data.slice().sort((a, b) => a.issue.localeCompare(b.issue));
records.forEach((r) => { r.red = r.red.map(Number); r.blue = Number(r.blue); });
S.store.state.records = records;
S.store.state.issues = records.map((r) => r.issue);
S.store.state.segments = S.store.computeSegments(S.store.state.issues);

// 最大连续段
const seg = S.store.largestSegment();
const start = seg.start, end = seg.end;
console.log("最大连续段:", start, "~", end, "共", seg.count, "期");

// 统计
const stats = S.stats.computeStats(S.store.getRecordsInRange(start, end).slice(-100));
console.log("统计 N=", stats.N, "和值均值=", stats.sum.mean.toFixed(1), "AC均值=", stats.ac.mean.toFixed(2));

// 各内置策略回测
for (const b of S.strategies.BUILTINS) {
  const res = S.backtest.runBacktest(
    { startIssue: start, endIssue: end, windowSize: 100, applyWindow: 1, strategyDef: { type: b.type, params: b.params }, seed: 12345 },
    records
  );
  console.log(`[${b.name}] 评估=${res.evaluated} 投入=${res.totalCost} 中奖=${res.totalWin} 净=${res.net} ROI=${res.roi.toFixed(1)}% 命中=${res.hitRate.toFixed(1)}%`);
}

// 自定义策略示例
const customDef = { type: "custom", params: { redMethod: "hot", blueMethod: "hot", k: 6, exclude: [], parityPref: "any", zoneBalance: false, allowConsecutive: true, mode: "single" } };
const rc = S.backtest.runBacktest({ startIssue: start, endIssue: end, windowSize: 100, applyWindow: 1, strategyDef: customDef, seed: 777 }, records);
console.log(`[自定义-热号] 评估=${rc.evaluated} ROI=${rc.roi.toFixed(1)}% 命中=${rc.hitRate.toFixed(1)}%`);

// 复式示例
const fs2 = { type: "hot", params: { k: 8 } };
const rf = S.backtest.runBacktest({ startIssue: start, endIssue: end, windowSize: 100, applyWindow: 1, strategyDef: fs2, seed: 999 }, records);
console.log(`[热号-复式K8] combos=${S.strategies.generatePicks(stats, fs2, Math.random).combos} 评估=${rf.evaluated} ROI=${rf.roi.toFixed(1)}%`);

console.log("OK");
