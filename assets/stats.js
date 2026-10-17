// stats.js — 双色球统计分析引擎（纯函数，挂载到 window.SSQ.stats）
window.SSQ = window.SSQ || {};
(function (S) {
  const RED_MAX = 33;
  const BLUE_MAX = 16;
  const ZONES = [
    { name: "区间1 (1-11)", min: 1, max: 11 },
    { name: "区间2 (12-22)", min: 12, max: 22 },
    { name: "区间3 (23-33)", min: 23, max: 33 },
  ];

  function emptyCount(max) {
    const o = {};
    for (let i = 1; i <= max; i++) o[i] = 0;
    return o;
  }

  // 计算一组开奖记录（分析窗口）的统计特征
  function computeStats(records) {
    const N = records.length;
    const redCount = emptyCount(RED_MAX);
    const blueCount = emptyCount(BLUE_MAX);
    const redOmission = emptyCount(RED_MAX); // 截至窗口最新一期的遗漏
    const blueOmission = emptyCount(BLUE_MAX);
    const lastSeen = {}; // number -> 在窗口中的下标（0=最旧）

    const oddDist = emptyCount(7); // 每期红球奇数个数分布 0..6
    const zoneDist = [0, 0, 0]; // 每期红球落入三区间的个数分布
    const sumArr = [];
    const acArr = [];
    const consecArr = []; // 每期连号组数

    records.forEach((rec, idx) => {
      const red = rec.red;
      red.forEach((n) => {
        redCount[n]++;
        lastSeen[n] = idx;
      });
      blueCount[rec.blue]++;
      // 奇偶
      let odd = 0;
      red.forEach((n) => (odd += n % 2));
      oddDist[odd]++;
      // 区间
      const z = [0, 0, 0];
      red.forEach((n) => {
        if (n <= 11) z[0]++;
        else if (n <= 22) z[1]++;
        else z[2]++;
      });
      zoneDist[0] += z[0];
      zoneDist[1] += z[1];
      zoneDist[2] += z[2];
      // 和值
      sumArr.push(red.reduce((a, b) => a + b, 0));
      // AC 值
      acArr.push(acValue(red));
      // 连号
      consecArr.push(consecutiveGroups(red));
    });

    // 遗漏：窗口最新下标 = N-1
    for (let i = 1; i <= RED_MAX; i++) {
      redOmission[i] = i in lastSeen ? N - 1 - lastSeen[i] : N;
    }
    for (let i = 1; i <= BLUE_MAX; i++) {
      blueOmission[i] = i in lastSeen ? N - 1 - lastSeen[i] : N;
    }

    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

    // 奖级均值（仅在有数据时）
    const prizeAvg = computePrizeAvg(records);

    return {
      N,
      redCount,
      blueCount,
      redOmission,
      blueOmission,
      redFreq: norm(redCount, N),
      blueFreq: norm(blueCount, N),
      oddDist,
      zoneDist,
      sum: { values: sumArr, mean: mean(sumArr), min: Math.min(...sumArr), max: Math.max(...sumArr) },
      ac: { values: acArr, mean: mean(acArr) },
      consec: { values: consecArr, mean: mean(consecArr) },
      prizeAvg,
      redHotRank: rankByValue(redCount, false),
      redColdRank: rankByValue(redOmission, true),
      blueHotRank: rankByValue(blueCount, false),
      blueColdRank: rankByValue(blueOmission, true),
    };
  }

  function norm(count, N) {
    const o = {};
    for (const k in count) o[k] = N ? count[k] / N : 0;
    return o;
  }

  function rankByValue(obj, byOmission) {
    // 返回 [{n, v}] 排序：热号按出现次数降序；冷号按遗漏升序（遗漏小=常出）
    const arr = Object.keys(obj).map((k) => ({ n: +k, v: obj[k] }));
    arr.sort((a, b) => (byOmission ? a.v - b.v : b.v - a.v));
    return arr;
  }

  function acValue(arr) {
    const s = new Set();
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) s.add(Math.abs(arr[i] - arr[j]));
    return s.size - (arr.length - 1);
  }

  function consecutiveGroups(arr) {
    const a = [...arr].sort((x, y) => x - y);
    let groups = 0;
    for (let i = 1; i < a.length; i++) if (a[i] === a[i - 1] + 1) groups++;
    return groups;
  }

  function computePrizeAvg(records) {
    const keys = ["prize1", "prize2", "prize3"];
    const out = {};
    keys.forEach((k) => {
      let c = 0,
        a = 0,
        valid = 0;
      records.forEach((r) => {
        const p = r[k];
        if (p && p.count != null && p.amount != null) {
          c += p.count;
          a += p.amount;
          valid++;
        }
      });
      out[k] = {
        avgCount: valid ? c / valid : null,
        avgAmount: valid ? a / valid : null,
        valid,
      };
    });
    return out;
  }

  S.stats = { computeStats, RED_MAX, BLUE_MAX, ZONES, acValue, consecutiveGroups };
})(window.SSQ);
