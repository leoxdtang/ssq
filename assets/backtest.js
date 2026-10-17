// backtest.js — 策略回测引擎 + 双色球计奖，挂载到 window.SSQ.backtest
window.SSQ = window.SSQ || {};
(function (S) {
  const FIXED = { 3: 3000, 4: 200, 5: 10, 6: 5 }; // 三等奖及以下固定金额

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 单注（6红+1蓝）与某期实际开奖比对，返回 {tier, amount}
  function prizeFor(myRed, myBlue, actual) {
    const set = new Set(myRed);
    let mr = 0;
    actual.red.forEach((n) => (mr += set.has(n) ? 1 : 0));
    const mb = myBlue === actual.blue ? 1 : 0;
    if (mr === 6 && mb === 1) return { tier: 1, amount: actual.prize1?.amount ?? 0 };
    if (mr === 6) return { tier: 2, amount: actual.prize2?.amount ?? 0 };
    if (mr === 5 && mb === 1) return { tier: 3, amount: FIXED[3] };
    if (mr === 5 || (mr === 4 && mb === 1)) return { tier: 4, amount: FIXED[4] };
    if (mr === 4 || (mr === 3 && mb === 1)) return { tier: 5, amount: FIXED[5] };
    if (mb === 1) return { tier: 6, amount: FIXED[6] }; // 2+1 / 1+1 / 0+1
    return { tier: 0, amount: 0 };
  }

  // 枚举从 candidates 中取 6 个的所有组合
  function combos6(cands, cb) {
    const n = cands.length;
    if (n < 6) return;
    const idx = [0, 1, 2, 3, 4, 5];
    while (true) {
      cb(idx.map((i) => cands[i]));
      let i = 5;
      while (i >= 0 && idx[i] === n - 6 + i) i--;
      if (i < 0) break;
      idx[i]++;
      for (let j = i + 1; j < 6; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  // 计算某期总奖金（支持单式/复式）
  function winningsForPick(pick, actual) {
    if (pick.mode === "single") {
      const r = prizeFor(pick.red, pick.blue[0], actual);
      return { amount: r.amount, tier: r.tier };
    }
    // 复式：枚举红球组合 × 蓝球
    let total = 0;
    const tierHit = {};
    combos6(pick.red, (six) => {
      for (const b of pick.blue) {
        const r = prizeFor(six, b, actual);
        if (r.amount > 0) {
          total += r.amount;
          tierHit[r.tier] = (tierHit[r.tier] || 0) + 1;
        }
      }
    });
    // 主奖级取金额最大的命中
    let topTier = 0;
    for (const t of Object.keys(tierHit)) if (+t > topTier) topTier = +t;
    return { amount: total, tier: topTier, tierHit };
  }

  /**
   * 运行回测
   * config: { startIssue, endIssue, windowSize, applyWindow, strategyDef, seed }
   * records: 全量记录（按 issue 升序）
   */
  function runBacktest(config, records) {
    const W = Math.max(5, config.windowSize | 0);
    const A = Math.max(1, config.applyWindow | 0);
    const start = config.startIssue;
    const end = config.endIssue;
    const rng = mulberry32(config.seed || 12345);

    // 筛选区间内记录（保留原始下标以便取窗口）
    const idxInRange = [];
    records.forEach((r, i) => {
      if (r.issue >= start && r.issue <= end) idxInRange.push(i);
    });

    const tierNames = { 1: "一等奖", 2: "二等奖", 3: "三等奖", 4: "四等奖", 5: "五等奖", 6: "六等奖" };
    const tierCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const tierAmounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let totalCost = 0,
      totalWin = 0,
      evaluated = 0,
      hits = 0;
    let currentPick = null,
      evalCount = 0;
    let cumNet = 0;
    let peak = 0,
      maxDrawdown = 0;
    let lossStreak = 0,
      maxLossStreak = 0;
    const equity = [];
    const details = [];
    const missingPrizePeriods = []; // 浮动奖金额缺失的期（影响一/二等奖估算）

    for (let q = 0; q < idxInRange.length; q++) {
      const j = idxInRange[q];
      if (j < W) continue; // 需要 W 期历史窗口
      // 连续性检查：窗口 [j-W, j-1] 与 j 本身必须连续开奖（无缺口 / 跨年跳号已容错）
      let contiguous = true;
      for (let s = j - W; s < j; s++) {
        if (!S.store.isConsecutive(records[s], records[s + 1])) {
          contiguous = false;
          break;
        }
      }
      if (!contiguous) {
        currentPick = null; // 缺口打断，下一有效点重新生成
        continue;
      }

      // 到达应用窗口边界或尚无选号时，用窗口重新生成
      if (evalCount % A === 0 || !currentPick) {
        const windowRecs = records.slice(j - W, j);
        const stats = S.stats.computeStats(windowRecs);
        currentPick = S.strategies.generatePicks(stats, config.strategyDef, rng);
        evalCount = 0;
      }

      const target = records[j];
      const w = winningsForPick(currentPick, target);
      const cost = currentPick.cost;
      totalCost += cost;
      totalWin += w.amount;
      evaluated++;
      if (w.amount > 0) {
        hits++;
        tierCounts[w.tier]++;
        tierAmounts[w.tier] += w.amount;
      }
      if (w.tier === 1 && (target.prize1 == null || target.prize1.amount == null))
        missingPrizePeriods.push(target.issue);
      if (w.tier === 2 && (target.prize2 == null || target.prize2.amount == null))
        missingPrizePeriods.push(target.issue);

      const periodNet = w.amount - cost;
      cumNet += periodNet;
      if (cumNet > peak) peak = cumNet;
      const dd = peak - cumNet;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (periodNet < 0) {
        lossStreak++;
        if (lossStreak > maxLossStreak) maxLossStreak = lossStreak;
      } else lossStreak = 0;

      equity.push({ issue: target.issue, date: target.date, cumNet, win: w.amount, cost });
      details.push({
        issue: target.issue,
        date: target.date,
        cost,
        win: w.amount,
        net: periodNet,
        tier: w.tier,
        tierName: tierNames[w.tier] || "未中奖",
        red: currentPick.red,
        blue: currentPick.blue,
      });
      evalCount++;
    }

    const net = totalWin - totalCost;
    return {
      config,
      evaluated,
      totalCost,
      totalWin,
      net,
      roi: totalCost ? (net / totalCost) * 100 : 0,
      hitRate: evaluated ? (hits / evaluated) * 100 : 0,
      tierCounts,
      tierAmounts,
      tierNames,
      maxDrawdown,
      maxLossStreak,
      equity,
      details,
      missingPrizePeriods: [...new Set(missingPrizePeriods)],
      pick: currentPick,
    };
  }

  S.backtest = { runBacktest, prizeFor, FIXED, combos6 };
})(window.SSQ);
