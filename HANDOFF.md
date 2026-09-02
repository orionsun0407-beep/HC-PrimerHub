# HC PrimerHub 交接说明

## 当前状态

核心功能、真实实验文件兼容性、桌面/移动端界面和 PWA 构建均已完成。正式上线只依赖两个外部步骤：创建 Supabase 项目并设置 GitHub Actions secrets。

## 已验证的真实数据

- 历史订单实测：解析出 170 条订单记录、163 个唯一序列、7 条重复序列备注；文件名日期范围 2025-11-10 至 2026-08-27。
- SnapGene `.dna` 实测：识别出 16 个带添加时间的自建 Primer，16 个均合格；3 个无 `dateAdded` 的内置通用 Primer 自动忽略。低于文件最低 Tm 的短弱匹配不计入多位点判断。
- Biosune 订单模板：识别工作表“订单表”、第 11 行表头、第 12 行起始数据、A–J 字段；25 条 Primer 会自动扩展到第 36 行，长度公式保持正确。
- 反向互补查询、EcoRI/BamHI 1-based 位点、SnapGene 零基坐标换算、跨环状起点、最低 Tm 过滤、最近 7 天与内置 Primer 排除逻辑均有自动化测试。
- 铂尚订单表已去除个人信息、旧引物和私人超链接后作为系统内置默认模板，所有用户无需上传即可使用；客户单位、联系人、电话、邮箱、发票抬头、负责人、地址和结算方式按账号保存在 Supabase Auth user metadata 中，生成下载文件时才回填。用户也可从已有铂尚订单在浏览器本地读取这些字段。

## 数据边界

- 云端：Primer 结构化信息、各账号私有订购资料、空白订单模板、模板字段映射与默认参数。
- 仅本地下载：生成的订单文件。
- 不上传：原始 `.dna`、历史订单文件夹、生成后的订单。

## 上线清单

- [ ] 创建 Supabase 项目并执行 `supabase/schema.sql`
- [ ] 注册并验证所有者邮箱，并把它配置为 `VITE_OWNER_EMAIL`
- [ ] 创建 GitHub 仓库 `HC-PrimerHub`
- [ ] 设置 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 与 `VITE_OWNER_EMAIL` 三个 Actions secrets
- [ ] 将 Pages Source 设为 GitHub Actions
- [ ] 首次部署后把 Pages URL 加入 Supabase Redirect URLs
- [ ] 所有者账号执行历史迁移并导出备份

## 常用命令

```bash
npm run dev
npm test
npm run build
```
