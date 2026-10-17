// strategies.js — 选号策略引擎（内置策略 + 可视化自定义规则），挂载到 window.SSQ.strategies
window.SSQ = window.SSQ || {};
(function (S) {
  const { RED_MAX, BLUE_MAX } = S.stats;

  // 从排名数组中按模式挑选候选号
  function pickFromRank(rank, k, exclude) {
    const ex = new Set(exclude || []);
    const out = [];
    for (const it of rank) {
      if (ex.has(it.n)) continue;
      out.push(it.n);
      if (out.length >= k) break;
    }
    return out;
  }

  function pickRandom(k, exclude, rng) {
    const ex = new Set(exclude || []);
    const pool = [];
    for (let i = 1; i <= RED_MAX; i++) if (!ex.has(i)) pool.push(i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  }

  // 在候选集中按约束（区间均衡 / 奇偶均衡 / 禁连号）做局部调整，得到 6 个红球的单式
  function refineToSingle(cands, stats, params) {
    let sel = cands.slice(0, 6);
    const ex = new Set(params.exclude || []);
    const score = (n) =>
      (stats.redCount[n] || 0) * 0.5 + (stats.redOmission[n] || 0) * 0.5;

    if (params.zoneBalance) {
      const zoneOf = (n) => (n <= 11 ? 0 : n <= 22 ? 1 : 2);
      // 若某区间为 0，从候选外的同区间最高分补入
      for (let z = 0; z < 3; z++) {
        if (!sel.some((n) => zoneOf(n) === z)) {
          let best = null,
            bv = -1;
          for (let n = 1; n <= RED_MAX; n++) {
            if (ex.has(n) || sel.includes(n) || zoneOf(n) !== z) continue;
            if (score(n) > bv) (bv = score(n)), (best = n);
          }
          if (best != null) sel[sel.length - 1] = best;
        }
      }
    }
    if (params.parityPref === "balance") {
      const odd = sel.filter((n) => n % 2 === 1).length;
      if (odd < 2 || odd > 4) {
        // 用候选外奇偶相反且分数较高者替换当前极值
        const wantOdd = odd < 2; // 需要更多奇数
        let repIdx = wantOdd ? sel.indexOf(Math.max(...sel.filter((n) => n % 2 === 0)))
                             : sel.indexOf(Math.min(...sel.filter((n) => n % 2 === 1)));
        let best = null, bv = -1;
        for (let n = 1; n <= RED_MAX; n++) {
          if (ex.has(n) || sel.includes(n)) continue;
          if ((n % 2 === 1) !== wantOdd) continue;
          if (score(n) > bv) (bv = score(n)), (best = n);
        }
        if (best != null && repIdx >= 0) sel[repIdx] = best;
      }
    }
    if (!params.allowConsecutive) {
      // 若出现相邻，替换其中一个为分数较高且无相邻的号
      let guard = 0;
      while (guard++ < 20) {
        sel.sort((a, b) => a - b);
        let i = 1;
        for (; i < sel.length; i++) if (sel[i] === sel[i - 1] + 1) break;
        if (i >= sel.length) break;
        let best = null, bv = -1;
        for (let n = 1; n <= RED_MAX; n++) {
          if (ex.has(n) || sel.includes(n)) continue;
          if (sel.some((m) => Math.abs(m - n) === 1)) continue;
          if (score(n) > bv) (bv = score(n)), (best = n);
        }
        if (best == null) break;
        sel[i - 1] = best;
      }
    }
    return sel.slice(0, 6).sort((a, b) => a - b);
  }

  // 统一入口：根据策略定义 + 窗口统计，产出选号
  // def = { type, params }  params 含 k/exclude/parityPref/zoneBalance/allowConsecutive/mode/redMethod/blueMethod
  function generatePicks(stats, def, rng) {
    rng = rng || Math.random;
    const p = Object.assign(
      { k: 6, exclude: [], parityPref: "any", zoneBalance: false, allowConsecutive: true, mode: "single" },
      def.params || {}
    );
    let red, blue;

    switch (def.type) {
      case "random":
        red = pickRandom(6, p.exclude, rng);
        blue = pickRandom(1, p.exclude, rng);
        return pack(red, blue, "single");
      case "hot":
        red = pickFromRank(stats.redHotRank, p.k, p.exclude);
        blue = pickFromRank(stats.blueHotRank, 1, p.exclude);
        break;
      case "cold":
        red = pickFromRank(stats.redColdRank, p.k, p.exclude);
        blue = pickFromRank(stats.blueColdRank, 1, p.exclude);
        break;
      case "omission":
        red = pickFromRank(
          [...stats.redColdRank].sort((a, b) => b.v - a.v),
          p.k,
          p.exclude
        );
        blue = pickFromRank(
          [...stats.blueColdRank].sort((a, b) => b.v - a.v),
          1,
          p.exclude
        );
        break;
      case "balanced":
      case "custom": {
        const rm = def.type === "balanced" ? "composite" : p.redMethod || "composite";
        const bm = def.type === "balanced" ? "composite" : p.blueMethod || "composite";
        red = pickFromRank(compositeRank(stats, rm), p.k, p.exclude);
        blue = pickFromRank(compositeRank(stats, bm, true), 1, p.exclude);
        if (def.type === "balanced") {
          p.zoneBalance = true;
          p.parityPref = "balance";
        }
        break;
      }
      case "zone": {
        red = zonePick(stats, p.exclude);
        blue = pickFromRank(stats.blueHotRank, 1, p.exclude);
        break;
      }
      default:
        red = pickFromRank(stats.redHotRank, 6, p.exclude);
        blue = pickFromRank(stats.blueHotRank, 1, p.exclude);
    }

    const blueCount = Math.max(1, (blue || []).length);
    if (p.k <= 6) {
      const blueSingle = blue.slice(0, 1);
      return pack(refineToSingle(red, stats, p), blueSingle, "single");
    }
    // 复式：保留 k 个红球候选 + 选定蓝球；按“最大投注注数”上限裁剪，避免成本失控
    const maxCombos = Math.max(1, p.maxCombos || 500);
    let useK = p.k;
    while (useK > 6) {
      if (S.strategies.combinations(useK, 6) * blueCount <= maxCombos) break;
      useK--;
    }
    const finalRed = red.slice(0, useK).sort((a, b) => a - b);
    const finalBlue = blue.slice(0, blueCount);
    const pk = pack(finalRed, finalBlue, "multiple", useK);
    pk.capped = useK < p.k;
    pk.requestedK = p.k;
    pk.maxCombos = maxCombos;
    return pk;
  }

  function compositeRank(stats, method, isBlue) {
    const rank = isBlue
      ? method === "omission"
        ? [...stats.blueColdRank].sort((a, b) => b.v - a.v)
        : method === "frequency"
        ? stats.blueHotRank
        : mergeScore(stats.blueCount, stats.blueOmission)
      : method === "omission"
      ? [...stats.redColdRank].sort((a, b) => b.v - a.v)
      : method === "frequency"
      ? stats.redHotRank
      : mergeScore(stats.redCount, stats.redOmission);
    return rank;
  }

  function mergeScore(count, omission) {
    const arr = Object.keys(count).map((k) => ({ n: +k }));
    const maxC = Math.max(...arr.map((x) => count[x.n] || 0)) || 1;
    const maxO = Math.max(...arr.map((x) => omission[x.n] || 0)) || 1;
    arr.forEach((x) => {
      x.v = ((count[x.n] || 0) / maxC) * 0.5 + ((omission[x.n] || 0) / maxO) * 0.5;
    });
    arr.sort((a, b) => b.v - a.v);
    return arr;
  }

  function zonePick(stats, exclude) {
    const ex = new Set(exclude || []);
    const zoneOf = (n) => (n <= 11 ? 0 : n <= 22 ? 1 : 2);
    const out = [];
    for (let z = 0; z < 3; z++) {
      const rank = Object.keys(stats.redCount)
        .map((k) => ({ n: +k, v: stats.redCount[k] }))
        .filter((x) => zoneOf(x.n) === z && !ex.has(x.n))
        .sort((a, b) => b.v - a.v);
      for (let i = 0; i < 2 && i < rank.length; i++) out.push(rank[i].n);
    }
    return out.sort((a, b) => a - b);
  }

  function pack(red, blue, mode, k) {
    const kRed = red.length;
    const mBlue = blue.length;
    const combos =
      mode === "single" ? 1 : combinations(kRed, 6) * Math.max(1, mBlue);
    return {
      red,
      blue,
      mode,
      k: kRed,
      combos,
      cost: combos * 2,
    };
  }

  function combinations(n, r) {
    if (r < 0 || r > n) return 0;
    let res = 1;
    for (let i = 0; i < r; i++) res = (res * (n - i)) / (i + 1);
    return Math.round(res);
  }

  // 内置策略清单（type 与默认参数）
  const BUILTINS = [
    { type: "random", name: "随机策略（默认）", desc: "完全随机选号，作为基准对照", params: {} },
    { type: "hot", name: "热号策略", desc: "选取窗口内出现频率最高的红球与蓝球", params: { k: 6 } },
    { type: "cold", name: "冷号策略", desc: "选取窗口内出现频率最低的红球与蓝球", params: { k: 6 } },
    { type: "omission", name: "遗漏反转策略", desc: "选取遗漏值（未出现期数）最大的号", params: { k: 6 } },
    { type: "balanced", name: "温号均衡策略", desc: "冷热综合评分，并约束奇偶/区间均衡", params: { k: 6 } },
    { type: "zone", name: "区间均衡+和值中枢", desc: "每区间选 2 红，贴近历史和值中枢", params: { k: 6 } },
  ];

  S.strategies = { generatePicks, BUILTINS, combinations };
})(window.SSQ);
