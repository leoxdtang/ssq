// charts.js — ECharts 封装，挂载到 window.SSQ.charts
window.SSQ = window.SSQ || {};
(function (S) {
  const charts = {};
  function render(id, option) {
    const el = document.getElementById(id);
    if (!el) return;
    let c = charts[id];
    if (c && c.getDom() && c.getDom().isConnected) {
      c.setOption(option, true);
      return c;
    }
    if (c) c.dispose(); // 旧实例对应的 DOM 已被 v-if 卸载，重建
    c = echarts.init(el);
    charts[id] = c;
    c.setOption(option, true);
    return c;
  }
  function resizeAll() {
    Object.values(charts).forEach((c) => c.resize());
  }
  window.addEventListener("resize", resizeAll);

  S.charts = { render, resizeAll };
})(window.SSQ);
