# GitHub Pages 是什么 · 如何申请账号并部署本平台

本指南面向**没有 GitHub 经验**的用户，手把手说明：GitHub Pages 是什么、怎么注册账号、怎么把本平台免费发布到网上并自动更新。

---

## 一、GitHub Pages 是什么？

- **GitHub** 是全球最大的代码托管平台（免费注册），可以理解为一个“放代码/文件的网盘 + 发布平台”。
- **GitHub Pages** 是 GitHub 提供的一项**免费静态网页托管**服务：你把网页文件（HTML/CSS/JS）放进一个仓库，GitHub 就会给你一个 `https://你的用户名.github.io/仓库名/` 的网址，任何人都能访问。
- **适合本平台吗？** 非常适合。本平台是纯静态网页（无需服务器、无后端），完美契合 Pages。
- **自动更新**：本平台已内置 GitHub Actions 工作流（`.github/workflows/update-data.yml`），部署后会在每周二/四/日晚开奖后 + 每日兜底，自动抓取最新开奖数据并提交，Pages 页面随之更新——**无需你手动维护**。

> 如果你只是本地用，双击 `index.html` 即可，完全不需要 GitHub Pages。本指南仅在你想“发到网上、手机也能看、还能自动更新”时参考。

---

## 二、申请 GitHub 账号

1. 打开 https://github.com （如打不开，可用 https://github.com 或镜像，国内访问通常正常）。
2. 点击右上角 **Sign up（注册）**。
3. 按提示填写：
   - **邮箱**（用你常用的，如 QQ/163/Outlook 邮箱）；
   - **密码**（至少 15 位或含数字的 8 位以上）；
   - **用户名（Username）**：这是你网址的一部分，只能字母/数字/短横，建议简短好记（如 `leotang`）。
4. 完成邮箱验证（去邮箱点验证链接）和人机验证。
5. 注册成功即拥有账号，**免费**。

> 账号免费，GitHub Pages 也免费；不需要绑卡、不需要付费。

---

## 三、创建一个仓库（Repository）

1. 登录后，点击页面右上角 **“+” → New repository（新建仓库）**。
2. 填写：
   - **Repository name（仓库名）**：例如 `ssq` 或 `shuangseqiu`。这个名字会出现在网址里（`https://用户名.github.io/仓库名`）。
   - **Description（描述）**：可填“双色球策略分析平台”。
   - **可见性**：选 **Public（公开）**——Pages 免费版要求公开仓库。
   - 勾选 **Add a README file**（可选）。
3. 点击 **Create repository** 创建。

---

## 四、把本平台文件上传到仓库

你有两种方式，选其一。

### 方式 A：网页拖拽上传（最简单，无需装软件）
1. 进入刚创建的仓库页面，点击 **Add file → Upload files**。
2. 把你本地的整个 `双色球` 文件夹里的**所有内容**（`index.html`、`README.md`、`assets/`、`data/`、`scripts/`、`.github/`）拖进去。
   - 注意：要连着 `assets`、`data`、`.github` 这些**文件夹**一起上传，保持目录结构不变。
3. 页面底部填提交说明（如“初始提交”），点 **Commit changes**。

### 方式 B：用 Git 命令行（适合会一点的用户）
```bash
# 在本地“双色球”文件夹内打开终端
git init
git add .
git commit -m "初始提交：双色球策略分析平台"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

---

## 五、启用 GitHub Pages（用 GitHub Actions 方式）

1. 在仓库页面，点击顶部 **Settings（设置）**。
2. 左侧找到 **Pages**（在 “Code and automation” 分类下）。
3. 在 **Build and deployment → Source** 下拉框，选择 **GitHub Actions**。
4. 无需再选主题。保存后，GitHub 会读取仓库里的 `.github/workflows/update-data.yml` 与 `.github/workflows/pages.yml`（见下方“补充”）来构建并发布。
5. 稍等 1–2 分钟，访问 `https://你的用户名.github.io/你的仓库名/` 即可看到平台。

> 首次发布通常需要 1–2 分钟构建。若打不开，稍等刷新；若提示 404，确认文件已上传且 `index.html` 在仓库根目录。

### 关于 Pages 构建工作流（重要）
本平台用“GitHub Actions”方式发布，需要一个 **Pages 构建工作流**来把静态文件搬上网。请确认仓库里包含 `.github/workflows/pages.yml`（若之前只有 `update-data.yml`，请补上下面内容并上传）：

```yaml
# .github/workflows/pages.yml
name: Deploy Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'          # 仓库根目录即网站根
      - id: deployment
        uses: actions/deploy-pages@v4
```

> 提示：两个工作流（`pages.yml` 负责发布，`update-data.yml` 负责每日更新数据）互不冲突，可并存。

---

## 六、启用“自动更新数据”

- 数据更新工作流 `update-data.yml` 已随文件上传。
- 在仓库 **Actions** 标签页里，左侧能看到 **Update SSQ Data** 与 **Deploy Pages** 两个工作流。
- 首次请手动触发一次：进入 **Actions → Update SSQ Data → Run workflow**，它会在能访问数据源的网络下抓取完整（含补全缺口）数据并提交，Pages 自动刷新。
- 之后按设定时间（每周二/四/日晚 + 每日）自动运行。也可随时手动再点一次“Run workflow”强制更新。

---

## 七、常见问题

- **访问很慢 / 打不开？** GitHub Pages 服务器在境外，国内有时较慢，可多刷新或稍后访问；不影响本地双击使用。
- **数据不更新？** 去 **Actions** 看 `Update SSQ Data` 是否成功（绿色✔）。失败多为数据源临时不可达，重试即可。
- **改了数据想立刻生效？** 在 Actions 手动跑一次 `Update SSQ Data`。
- **不想联网发布？** 完全可以不部署，直接双击 `index.html` 离线使用；需要新数据时点页面里的“联网检查并更新数据”按钮即可。

---

## 八、如果完全不想用 GitHub

你**不需要** GitHub Pages 也能用本平台：
1. 双击 `index.html` 离线使用；
2. 数据更新：在页面点“联网检查并更新数据”（直接从你的浏览器拉取，不依赖任何账号），再把下载的 `ssq.js` / `ssq.json` 覆盖本地同名文件即可。
3. 或在能联网的电脑上运行 `node scripts/fetch-data.mjs` 重新生成数据文件。
