# HC PrimerHub

一个面向个人实验工作的私有 Primer 管理与订购 PWA。它把历史订单迁移、SnapGene 导入、序列查询、酶切位点扫描、模板结合图和供应商订单生成整合在同一个网页中。

## 已实现功能

- 邮箱注册、登录、找回密码；每个账号的数据通过 Supabase RLS 完全隔离。
- 按名称、完整或部分序列、反向互补序列、订购日期、限制性内切酶查询。
- 读取 SnapGene `.dna` 文件以及 TXT/TSV/CSV 导出的 Primer 列表。
- 默认只读取最近 7 天内带 `dateAdded` 的自建 Primer；没有添加时间的 SnapGene 内置通用 Primer 自动忽略，也可关闭最近 7 天筛选查看全部自建 Primer。
- 自动与已有 Primer 库按标准化序列去重；同序列不同名称会在备注中直接写出已有名称。
- `.dna` Primer 必须在模板上恰好有一个达到文件最低 Tm 设置的真实结合位点；低温短弱匹配和 `simplified="1"` 展示副本不重复计数，零个或多个有效位点会标记为不合格并禁止下单。
- 保存模板名称、1-based 结合起止位置、链方向，以及结合位点前后各 20 bp；动态绘制类似 SnapGene 的上下链示意图。
- 已有 Primer 可从库内直接“再次合成”，支持多选并与新 Primer 合并生成同一份订单；完成后更新最近订购时间，并在备注中保留此前订购时间。
- 内置已清除个人信息和旧引物的铂尚 Excel 订单表，作为所有用户的系统默认模板；无需上传即可直接生成订单。
- 每个账号可私密保存自己的客户单位、联系人、电话、邮箱、发票抬头、课题组负责人、地址和结算方式；可从已有铂尚订单本地读取，生成下载文件时自动回填。
- 自动扫描常用限制性内切酶，保存酶名、识别序列、1-based 位置和链方向。
- 上传任意 `.xlsx` 订购模板，自动识别表头；必要时手动映射一次并保存。支持模板默认规格、管数、纯化、修饰、交付和备注。
- 由用户勾选新 Primer，生成并下载订单后立即写入 Primer 库。
- 从历史订单文件夹批量迁移；仅环境变量指定的所有者账号显示迁移入口。
- 手工新增、编辑、删除，以及 Excel/CSV 备份。
- 响应式界面和 PWA，可在电脑与手机浏览器中安装。

## 数据与隐私

GitHub Pages 只托管静态前端代码，不保存实验数据。云端只保存结构化 Primer 信息、当前账号的私有订购资料，以及你主动上传的空白订购模板和字段映射；生成的订单只下载到当前设备，不上传云端。订购资料存放在当前 Supabase Auth 用户的 metadata 中，不写入公共模板或前端源码。

仓库中的 Supabase `anon` key 会随前端公开，这是 Supabase 的正常设计。真正的数据保护来自 [supabase/schema.sql](supabase/schema.sql) 中启用的 Row Level Security。绝不要把 `service_role` key 放入前端、`.env.local` 或 GitHub Pages。

## 本地运行

需要 Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env.local
npm run dev
```

如果没有填写 Supabase 环境变量，应用会进入“本地演示”模式，数据仅保存在当前浏览器的 `localStorage`，适合界面测试，不适合正式使用。

## 配置 Supabase

1. 在 Supabase 创建免费项目。
2. 打开项目的 SQL Editor，完整执行 [supabase/schema.sql](supabase/schema.sql)。它会创建数据表、索引、更新时间触发器、私有模板存储桶和用户隔离策略。
3. 在 Supabase 项目设置中复制 Project URL 与 `anon`/publishable key，写入本地 `.env.local`：

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   VITE_OWNER_EMAIL=YOUR_LOGIN_EMAIL
   ```

4. 在 Authentication → URL Configuration 中，把本地地址和最终 GitHub Pages 地址加入允许的 Redirect URLs。例如：

   ```text
   http://localhost:5173/HC-PrimerHub/
   https://YOUR_GITHUB_USER.github.io/HC-PrimerHub/
   ```

5. 建议保留邮箱确认，并在正式迁移前先用所有者邮箱完成注册和验证。

## 部署到 GitHub Pages

仓库已包含 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)。默认仓库名为 `HC-PrimerHub`，对应 Vite 路径 `/HC-PrimerHub/`。

1. 新建同名 GitHub 仓库并推送 `main` 分支。
2. 在仓库 Settings → Secrets and variables → Actions 添加：
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_OWNER_EMAIL`
3. 在 Settings → Pages 中选择 Source: **GitHub Actions**。
4. 重新运行 `Deploy HC PrimerHub to GitHub Pages` 工作流。

如果更改仓库名，需要同时修改 [vite.config.ts](vite.config.ts) 中的 `base` 和 PWA `start_url`。

## 第一次使用

1. 登录所有者账号。
2. 在“订购模板”保存自己的订购资料；可以逐项填写，也可以选择一份已有铂尚订单在浏览器本地读取。若使用其他供应商，再上传对应的空白 `.xlsx` 并确认字段映射。
3. 在“备份与迁移”选择保存历史订单的文件夹。预览记录数后再确认写入。
4. 在“导入与下单”选择 `.dna` 或 Primer 文本文件，或从 Primer 库选择需要再次合成的记录；检查结果后合并生成并下载订单。
5. 导入完成后先导出一次 Excel 备份。

## 验证

```bash
npm test
npm run build
```

项目还包含只读检查脚本，用于本地验证真实 `.dna`、历史订单和供应商模板。它们不会上传源文件或生成的订单。
