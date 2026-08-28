# HC PrimerHub 交接说明

## 当前状态

核心功能、真实实验文件兼容性、桌面/移动端界面和 PWA 构建均已完成。正式上线只依赖两个外部步骤：创建 Supabase 项目并设置 GitHub Actions secrets。

## 已验证的真实数据

- 历史订单实测：解析出 170 条订单记录、163 个唯一序列、7 条重复序列备注；文件名日期范围 2025-11-10 至 2026-08-27。
- SnapGene `.dna` 实测：解析出 17 个 Primer，其中 16 个合格；含 2 个真实模板结合位点的 Primer 被正确禁用。
- Biosune 订单模板：识别工作表“订单表”、第 11 行表头、第 12 行起始数据、A–J 字段；25 条 Primer 会自动扩展到第 36 行，长度公式保持正确。
- 反向互补查询、EcoRI/BamHI 1-based 位点、SnapGene `simplified="1"` 排除逻辑均有自动化测试。

## 数据边界

- 云端：Primer 结构化信息、空白订单模板、模板字段映射与默认参数。
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
