// app.js — Vue 应用（Options API），挂载并驱动各功能
(function () {
  const { createApp } = Vue;
  const SSQ = window.SSQ;

  createApp({
    data() {
      return {
        activeTab: "overview",
        loaded: false,
        error: null,
        updating: false,
        updateMsg: "",
        updateLog: [],
        records: [],
        meta: {},
        segments: [],
        latest: {},
        recentRows: [],
        minIssue: "",
        maxIssue: "",
        rangeText: "",
        gapText: "",
        gaps: [],            // 所有断裂 [{from,to,fromDate,toDate,days,real}]
        realGapCount: 0,     // 真正的数据缺失缺口数（间隔>60天）
        historicalGapText: "", // 历史真实空档说明（春节/疫情，无需补全）

        builtins: SSQ.strategies.BUILTINS,
        builtinIdx: 0,
        useCustom: false,
        custom: {
          redMethod: "composite",
          blueMethod: "composite",
          k: 6,
          excludeText: "",
          parityPref: "any",
          zoneBalance: false,
          allowConsecutive: true,
          maxCombos: 500,
        },
        previewW: 100,
        previewPick: null,

        statsStart: null,
        statsEnd: null,
        statsW: 100,
        statsInfo: "",
        statsResult: null,

        useCustomBt: false,
        btStart: null,
        btEnd: null,
        btW: 100,
        btA: 1,
        btSeed: 20260817,
        btInfo: "",
        btResult: null,

        compareIdx: [0, 1, 2],
        cStart: null,
        cEnd: null,
        cW: 100,
        cA: 1,
        cSeed: 20260817,
        compareResult: null,
      };
    },
    mounted() {
      SSQ.store.load().then((st) => this.onStoreLoaded(st));
    },
    methods: {
      onStoreLoaded(st) {
        this.loaded = st.loaded;
        this.error = st.error;
        this.records = st.records;
        this.meta = st.meta || {};
        this.segments = st.segments || [];
        this.gaps = this.analyzeGaps();
        if (this.records.length) {
          this.latest = this.records[this.records.length - 1];
          this.recentRows = this.records.slice(-12).reverse();
          this.minIssue = this.records[0].issue;
          this.maxIssue = this.records[this.records.length - 1].issue;
          this.rangeText = this.minIssue + " ~ " + this.maxIssue;
          this.realGapCount = this.gaps.filter((g) => g.real).length;
          this.historicalGapText = this.gaps
            .filter((g) => !g.real)
            .map((g) => `${g.fromDate}~${g.toDate}（约 ${g.days} 天，春节休市/疫情停摆）`)
            .join("；");
          this.gapText = this.computeGapText();
          // 默认时间段 = 最大连续段
          const seg = SSQ.store.largestSegment();
          if (seg) {
            this.statsStart = seg.start;
            this.statsEnd = seg.end;
            this.btStart = seg.start;
            this.btEnd = seg.end;
            this.cStart = seg.start;
            this.cEnd = seg.end;
          }
          this.meta.rangeText = this.rangeText;
        }
      },
      // 联网更新数据（浏览器内，不依赖 GitHub Pages / Actions）
      async updateData() {
        this.updating = true;
        this.updateMsg = "正在联网拉取最新数据…";
        this.updateLog = [];
        try {
          const obj = await SSQ.update.fetchLatest();
          window.SSQ_DATA = obj; // 更新内存中的内嵌数据
          const st = await SSQ.store.load();
          this.onStoreLoaded(st);
          const segs = this.segments.length;
          this.updateMsg = `✅ 更新成功：共 ${obj.data.length} 期，区间 ${obj.data[0].issue} ~ ${obj.meta.latestIssue}` +
            (segs > 1 ? `（仍存在 ${segs - 1} 处缺口，说明主源未覆盖该区间）` : "（数据已连续）") +
            "。请点下方按钮下载数据文件覆盖本地，下次打开即为最新。";
        } catch (e) {
          this.updateMsg = "❌ 更新失败：" + e.message;
        } finally {
          this.updating = false;
        }
      },
      // 分批次联网更新（优先官方接口按缺口分批拉取，失败则镜像全量补全）
      async updateBatchedData() {
        this.updating = true;
        this.updateMsg = "分批次联网更新中…";
        this.updateLog = [];
        const log = (m) => { this.updateLog.push(m); };
        try {
          const obj = await SSQ.update.updateBatched(log);
          window.SSQ_DATA = obj;
          const st = await SSQ.store.load();
          this.onStoreLoaded(st);
          const segs = this.segments.length;
          this.updateMsg = `✅ 分批次更新完成：本次新增 ${obj.added} 期，现共 ${obj.data.length} 期` +
            (segs > 1 ? `；仍余 ${obj.gapsRemaining} 处缺口（如官方接口被跨域拦截，镜像可能未覆盖该区间，可改在能直连的网络下重试）` : "；数据已连续，缺口已补全。") +
            "。请点下方按钮下载数据文件覆盖本地。";
        } catch (e) {
          this.updateMsg = "❌ 更新失败：" + e.message;
        } finally {
          this.updating = false;
        }
      },
      downloadData(kind) {
        if (!window.SSQ_DATA) return;
        SSQ.update.download(window.SSQ_DATA, kind);
      },
      pad(n) {
        return String(n).padStart(2, "0");
      },
      fmt(v) {
        if (v == null || v === "" || isNaN(v)) return "—";
        return Number(v).toLocaleString("zh-CN");
      },
      computeGapText() {
        const real = (this.gaps || []).filter((g) => g.real);
        if (!real.length) return "";
        return real.map((g) => `${g.from}~${g.to}`).join("、");
      },
      // 分析所有相邻断裂：间隔>60天视为“数据缺失缺口”，否则为历史真实空档（春节/疫情）
      analyzeGaps() {
        const recs = this.records;
        const gaps = [];
        for (let i = 1; i < recs.length; i++) {
          if (!SSQ.store.isConsecutive(recs[i - 1], recs[i])) {
            const prev = recs[i - 1],
              cur = recs[i];
            const da = Date.parse(prev.date),
              db = Date.parse(cur.date);
            const days = isNaN(da) || isNaN(db) ? null : Math.round((db - da) / 86400000);
            gaps.push({
              from: prev.issue,
              to: cur.issue,
              fromDate: prev.date,
              toDate: cur.date,
              days,
              real: days != null ? days > 60 : true,
            });
          }
        }
        return gaps;
      },
      useLargestSeg() {
        const seg = SSQ.store.largestSegment();
        if (seg) {
          this.statsStart = seg.start;
          this.statsEnd = seg.end;
        }
      },
      useLargestSegBt() {
        const seg = SSQ.store.largestSegment();
        if (seg) {
          this.btStart = seg.start;
          this.btEnd = seg.end;
        }
      },
      // 取区间内末尾连续 W 期（不跨越缺口）
      trailingWindow(start, end, W) {
        const recs = SSQ.store.getRecordsInRange(start, end);
        if (!recs.length) return { recs: [], truncated: true };
        const out = [];
        let i = recs.length - 1;
        while (i >= 0 && out.length < W) {
          if (out.length === 0 || SSQ.store.isConsecutive(recs[i], recs[i + 1])) {
            out.unshift(recs[i]);
            i--;
          } else break;
        }
        return { recs: out, truncated: recs.length < W || out.length < W };
      },
      buildDef(useCustom) {
        if (useCustom) {
          const ex = (this.custom.excludeText || "")
            .split(/[,\s]+/)
            .map((s) => parseInt(s, 10))
            .filter((n) => !isNaN(n));
          const k = Math.max(6, this.custom.k | 0);
          return {
            type: "custom",
            params: {
              redMethod: this.custom.redMethod,
              blueMethod: this.custom.blueMethod,
              k,
              exclude: ex,
              parityPref: this.custom.parityPref,
              zoneBalance: this.custom.zoneBalance,
              allowConsecutive: this.custom.allowConsecutive,
              maxCombos: this.custom.maxCombos,
              mode: k > 6 ? "multiple" : "single",
            },
          };
        }
        const b = this.builtins[this.builtinIdx];
        return { type: b.type, params: Object.assign({}, b.params) };
      },

      runStats() {
        const { recs, truncated } = this.trailingWindow(this.statsStart, this.statsEnd, this.statsW);
        if (!recs.length) {
          this.statsInfo = "该时间段内无可用连续数据，请调整区间。";
          this.statsResult = null;
          return;
        }
        this.statsResult = SSQ.stats.computeStats(recs);
        this.statsInfo = `统计窗口：${recs[0].issue} ~ ${recs[recs.length - 1].issue}（共 ${recs.length} 期）` +
          (truncated ? "（受区间长度/缺口限制，已取末尾最大连续段）" : "");
        this.$nextTick(() => this.renderStatsCharts());
      },
      renderStatsCharts() {
        const s = this.statsResult;
        const redX = [];
        const redY = [];
        for (let i = 1; i <= 33; i++) {
          redX.push(this.pad(i));
          redY.push(s.redCount[i]);
        }
        SSQ.charts.render("chartRedFreq", {
          title: { text: "红球出现频率", left: "center" },
          grid: { top: 36, bottom: 28, left: 36, right: 12 },
          xAxis: { type: "category", data: redX, axisLabel: { fontSize: 9, interval: 1 } },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: redY, itemStyle: { color: "#e8413a" } }],
        });
        const blueX = [], blueY = [];
        for (let i = 1; i <= 16; i++) {
          blueX.push(this.pad(i));
          blueY.push(s.blueCount[i]);
        }
        SSQ.charts.render("chartBlueFreq", {
          title: { text: "蓝球出现频率", left: "center" },
          grid: { top: 36, bottom: 28, left: 36, right: 12 },
          xAxis: { type: "category", data: blueX, axisLabel: { fontSize: 9 } },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: blueY, itemStyle: { color: "#2f6fed" } }],
        });
        const omitX = [], omitY = [];
        for (let i = 1; i <= 33; i++) {
          omitX.push(this.pad(i));
          omitY.push(s.redOmission[i]);
        }
        SSQ.charts.render("chartRedOmit", {
          title: { text: "红球遗漏值(期)", left: "center" },
          grid: { top: 36, bottom: 28, left: 36, right: 12 },
          xAxis: { type: "category", data: omitX, axisLabel: { fontSize: 9, interval: 1 } },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: omitY, itemStyle: { color: "#f0a020" } }],
        });
        SSQ.charts.render("chartZone", {
          title: { text: "区间分布(红球)", left: "center" },
          grid: { top: 36, bottom: 28, left: 36, right: 12 },
          xAxis: { type: "category", data: SSQ.stats.ZONES.map((z) => z.name) },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: s.zoneDist, itemStyle: { color: "#16a085" } }],
        });
        const parityX = [], parityY = [];
        for (let i = 0; i <= 6; i++) {
          parityX.push(i + "奇");
          parityY.push(s.oddDist[i]);
        }
        SSQ.charts.render("chartParity", {
          title: { text: "奇数个数分布", left: "center" },
          grid: { top: 36, bottom: 28, left: 36, right: 12 },
          xAxis: { type: "category", data: parityX },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: parityY, itemStyle: { color: "#8e44ad" } }],
        });
        const bins = this.histogram(s.sum.values, 10);
        SSQ.charts.render("chartSum", {
          title: { text: "和值分布", left: "center" },
          grid: { top: 36, bottom: 28, left: 36, right: 12 },
          xAxis: { type: "category", data: bins.map((b) => b.label), axisLabel: { fontSize: 9, rotate: 30 } },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: bins.map((b) => b.count), itemStyle: { color: "#3aa0e8" } }],
        });
      },
      histogram(values, nb) {
        if (!values.length) return [];
        const lo = Math.min(...values), hi = Math.max(...values);
        const w = Math.max(1, Math.ceil((hi - lo + 1) / nb));
        const bins = [];
        for (let v = lo; v <= hi; v += w) bins.push({ label: v + "-", count: 0 });
        values.forEach((v) => {
          let i = Math.floor((v - lo) / w);
          if (i >= bins.length) i = bins.length - 1;
          if (i < 0) i = 0;
          bins[i].count++;
        });
        return bins;
      },

      runPreview() {
        const { recs, truncated } = this.trailingWindow(this.statsStart, this.statsEnd, this.previewW);
        if (!recs.length) {
          this.previewPick = null;
          return;
        }
        const stats = SSQ.stats.computeStats(recs);
        this.previewPick = SSQ.strategies.generatePicks(stats, this.buildDef(this.useCustom));
      },

      runBacktest() {
        const cfg = {
          startIssue: String(this.btStart),
          endIssue: String(this.btEnd),
          windowSize: this.btW,
          applyWindow: this.btA,
          strategyDef: this.buildDef(this.useCustomBt),
          seed: this.btSeed,
        };
        this.btResult = SSQ.backtest.runBacktest(cfg, this.records);
        this.btInfo = `回测区间：${cfg.startIssue} ~ ${cfg.endIssue}，有效评估 ${this.btResult.evaluated} 期。`;
        if (this.btResult.pick && this.btResult.pick.capped) {
          this.btInfo += `（复式注数超过上限 ${this.btResult.pick.maxCombos}，已自动裁剪为 ${this.btResult.pick.red.length} 个红球 / ${this.btResult.pick.combos} 注）`;
        }
        this.$nextTick(() => this.renderBacktestCharts());
      },
      renderBacktestCharts() {
        const r = this.btResult;
        SSQ.charts.render("chartEquity", {
          title: { text: "累计净收益曲线", left: "center" },
          grid: { top: 36, bottom: 40, left: 50, right: 16 },
          xAxis: { type: "category", data: r.equity.map((e) => e.issue), axisLabel: { fontSize: 8, interval: Math.floor(r.equity.length / 12) } },
          yAxis: { type: "value", name: "元" },
          series: [
            {
              type: "line",
              data: r.equity.map((e) => e.cumNet),
              showSymbol: false,
              areaStyle: { opacity: 0.15 },
              lineStyle: { color: "#e8413a" },
              itemStyle: { color: "#e8413a" },
            },
          ],
        });
        const names = Object.keys(r.tierCounts);
        SSQ.charts.render("chartTier", {
          title: { text: "各奖级命中次数", left: "center" },
          grid: { top: 36, bottom: 28, left: 36, right: 12 },
          xAxis: { type: "category", data: names.map((t) => r.tierNames[t]) },
          yAxis: { type: "value" },
          series: [{ type: "bar", data: names.map((t) => r.tierCounts[t]), itemStyle: { color: "#27ae60" } }],
        });
      },

      exportCsv() {
        const rows = [["期号", "日期", "投入", "中奖", "净收益", "奖级", "红球", "蓝球"]];
        this.btResult.details.forEach((d) => {
          rows.push([d.issue, d.date, d.cost, d.win, d.net, d.tierName, d.red.join(" "), d.blue.join(" ")]);
        });
        const csv = rows.map((r) => r.join(",")).join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "backtest_" + (this.btResult.config.strategyDef.type) + ".csv";
        a.click();
        URL.revokeObjectURL(a.href);
      },

      runCompare() {
        if (!this.compareIdx.length) {
          this.compareResult = null;
          return;
        }
        const base = {
          startIssue: String(this.cStart),
          endIssue: String(this.cEnd),
          windowSize: this.cW,
          applyWindow: this.cA,
          seed: this.cSeed,
        };
        const out = [];
        this.compareIdx.forEach((sel) => {
          let def, name;
          if (sel === "custom") {
            def = this.buildDef(true);
            name = "自定义策略";
          } else {
            const b = this.builtins[sel];
            def = { type: b.type, params: Object.assign({}, b.params) };
            name = b.name;
          }
          const res = SSQ.backtest.runBacktest(Object.assign({}, base, { strategyDef: def }), this.records);
          out.push({ name, evaluated: res.evaluated, net: res.net, roi: res.roi, hitRate: res.hitRate, totalCost: res.totalCost, totalWin: res.totalWin });
        });
        this.compareResult = out;
        this.$nextTick(() => {
          SSQ.charts.render("chartCompare", {
            title: { text: "策略 ROI 对比", left: "center" },
            grid: { top: 36, bottom: 50, left: 50, right: 16 },
            xAxis: { type: "category", data: out.map((r) => r.name), axisLabel: { fontSize: 9, rotate: 20 } },
            yAxis: { type: "value", name: "%" },
            series: [{ type: "bar", data: out.map((r) => +r.roi.toFixed(1)), itemStyle: { color: "#e8413a" } }],
          });
        });
      },
    },
  }).mount("#app");
})();
