#!/usr/bin/env python3
"""
一次性初始数据生成器（沙箱/本地可用）。
通过 GitHub API 拉取“可达”的历史源并合并为规范的 data/ssq.json：
  - UnstoppableL/lotterydata 的 lot_zhcw_ssq.txt（2003-2018，含一/二/三等奖金额）
  - sinyu1012/Double-Color-Ball-AI 的 data/lottery_history.json（2025-2026，含号码+日期）
说明：2018-2025 区间与 2018 年后的浮动奖金额缺口，由 scripts/fetch-data.mjs
在可访问中彩网/镜像的网络（GitHub Actions 或本机）首次运行后自动补全。
"""
import base64
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "ssq.json")

API = "https://api.github.com/repos/{repo}/contents/{path}"


def gh_get(repo, path):
    url = API.format(repo=repo, path=path)
    req = urllib.request.Request(url, headers={"User-Agent": "ssq-data-gen"})
    with urllib.request.urlopen(req, timeout=40) as r:
        d = json.load(r)
    if "content" not in d:
        raise RuntimeError(f"{repo}/{path} 无 content（可能超 1MB 限制）")
    return base64.b64decode(d["content"]).decode("utf-8", "replace")


def norm_issue(s):
    s = s.strip()
    if len(s) == 5:  # YYNNN -> YYYYNNN
        return "20" + s
    return s  # 已是 7 位 YYYYNNN


def to_int(x):
    x = (x or "").strip()
    return int(x) if x not in ("", "0", "00") else 0


def parse_zhcw(text):
    recs = {}
    for line in text.strip().split("\n"):
        p = line.split(",")
        if len(p) < 18:
            continue
        # 序号,日期,期号,红1..红6,蓝,销售额,一注,一奖,二注,二奖,三注,三奖,奖池
        date = p[1].strip()
        issue = norm_issue(p[2])
        red = [int(p[3 + i]) for i in range(6)]
        blue = int(p[9])
        sales = to_int(p[10])
        prize1 = {"count": to_int(p[11]), "amount": to_int(p[12])}
        prize2 = {"count": to_int(p[13]), "amount": to_int(p[14])}
        prize3 = {"count": to_int(p[15]), "amount": to_int(p[16])}
        pool = to_int(p[17])
        recs[issue] = {
            "issue": issue,
            "date": date,
            "red": red,
            "blue": blue,
            "sales": sales,
            "pool": pool,
            "prize1": prize1,
            "prize2": prize2,
            "prize3": prize3,
        }
    return recs


def parse_sinyu(text):
    j = json.loads(text)
    recs = {}
    for it in j.get("data", []):
        issue = norm_issue(it["period"])
        red = [int(x) for x in it["red_balls"]]
        blue = int(it["blue_ball"])
        recs[issue] = {
            "issue": issue,
            "date": it.get("date", ""),
            "red": red,
            "blue": blue,
            "sales": None,
            "pool": None,
            "prize1": None,
            "prize2": None,
            "prize3": None,
        }
    return recs


def main():
    print("拉取 zhcw 历史（2003-2018）...")
    zhcw = parse_zhcw(gh_get("UnstoppableL/lotterydata", "lot_zhcw_ssq.txt"))
    print(f"  zhcw 记录数: {len(zhcw)}")
    print("拉取 sinyu1012 近期（2025-2026）...")
    sinyu = parse_sinyu(gh_get("sinyu1012/Double-Color-Ball-AI", "data/lottery_history.json"))
    print(f"  sinyu 记录数: {len(sinyu)}")

    merged = {}
    merged.update(zhcw)  # 完整含奖金
    # sinyu 仅补充号码/日期（其奖金字段为 None，不覆盖 zhcw 的奖金）
    for k, v in sinyu.items():
        if k in merged:
            if not merged[k]["date"]:
                merged[k]["date"] = v["date"]
        else:
            merged[k] = v

    items = [merged[k] for k in sorted(merged.keys())]
    out = {
        "meta": {
            "generatedAt": "",
            "source": "initial: zhcw(2003-2018,含奖金) + sinyu1012(2025-2026,号码/日期); 2018-2025 与 2018 后浮动奖金待 fetch-data.mjs 补全",
            "totalIssues": len(items),
            "latestIssue": items[-1]["issue"] if items else "",
            "note": "本文件为初始回填，缺口将在可访问中彩网/镜像的网络（GitHub Actions 或本机运行 node scripts/fetch-data.mjs）后自动补全。",
        },
        "data": items,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"已写出 {OUT} 共 {len(items)} 期")
    print("区间:", items[0]["issue"], "~", items[-1]["issue"])


if __name__ == "__main__":
    main()
