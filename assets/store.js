// store.js — 数据加载与查询，挂载到 window.SSQ.store
window.SSQ = window.SSQ || {};
(function (S) {
  const state = {
    raw: null,
    meta: null,
    records: [], // 按 issue 升序
    issues: [], // 升序 issue 字符串
    segments: [], // 连续区间 [{start,end,count}]
    loaded: false,
    error: null,
  };

  async function load() {
    try {
      let json;
      // 优先使用内嵌数据（data/ssq.js 写入的全局量），可让 file:// 双击直接打开
      if (window.SSQ_DATA) {
        json = window.SSQ_DATA;
      } else {
        const res = await fetch("data/ssq.json", { cache: "no-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        json = await res.json();
      }
      state.raw = json;
      state.meta = json.meta || {};
      const recs = (json.data || []).slice().sort((a, b) => a.issue.localeCompare(b.issue));
      // 数值化 red/blue（确保为数组）
      recs.forEach((r) => {
        r.red = (r.red || []).map(Number);
        r.blue = Number(r.blue);
      });
      state.records = recs;
      state.issues = recs.map((r) => r.issue);
      state.segments = computeSegments(state.issues);
      state.loaded = true;
    } catch (e) {
      state.error = e.message || String(e);
      state.loaded = false;
    }
    return state;
  }

  function dayDiff(a, b) {
    const da = Date.parse(a.date),
      db = Date.parse(b.date);
    if (isNaN(da) || isNaN(db)) return null;
    return Math.round((db - da) / 86400000);
  }

  // 连续性判断：相邻两期是否为连续开奖（按日期，容忍 <=15 天；缺日期时退回期号容错）
  function isConsecutive(a, b) {
    const dd = dayDiff(a, b);
    if (dd != null) return dd >= 1 && dd <= 15;
    const diff = Number(b.issue) - Number(a.issue);
    return diff >= 1 && diff <= 900; // 仅容错跨年跳号
  }

  function computeSegments(issues) {
    if (!issues.length) return [];
    const recs = state.records;
    const byIssue = {};
    recs.forEach((r) => (byIssue[r.issue] = r));
    const seg = [];
    let sIdx = 0;
    for (let i = 1; i < issues.length; i++) {
      const prev = byIssue[issues[i - 1]],
        cur = byIssue[issues[i]];
      if (!prev || !cur || !isConsecutive(prev, cur)) {
        seg.push({ start: issues[sIdx], end: issues[i - 1], count: i - sIdx });
        sIdx = i;
      }
    }
    seg.push({ start: issues[sIdx], end: issues[issues.length - 1], count: issues.length - sIdx });
    return seg;
  }

  function getRecordsInRange(start, end) {
    return state.records.filter((r) => r.issue >= start && r.issue <= end);
  }

  // 默认回测区间：取最大的连续段
  function largestSegment() {
    if (!state.segments.length) return null;
    return state.segments.reduce((a, b) => (b.count > a.count ? b : a));
  }

  function issueToNumber(issue) {
    return Number(String(issue).replace(/^20/, ""));
  }

  S.store = { state, load, getRecordsInRange, largestSegment, computeSegments, isConsecutive, issueToNumber };
})(window.SSQ);
