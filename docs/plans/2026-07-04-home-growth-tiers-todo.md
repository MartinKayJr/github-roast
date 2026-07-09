# 首页成长型榜单与等级分段 TODO

## 背景

当前首页排行榜长期展示固定的高分开发者，容易让新用户只看一次就离开。最佳开发者榜可以保留，它有激励价值，但不能成为首页唯一的动态内容。新的首页应该同时传达两件事：

1. 站内确实有高水平开发者，顶部只展示少量代表。
2. 普通用户可以通过近期真实开源提交持续进步，并在自己的等级段里被看见。

目标是把首页从“静态上榜评分”改成“实时成长与圈层发现”的入口。

## 产品目标

- 首页布局上，`近期成长 / 成长榜` 应放在传统排行榜上方，先让用户看到“最近谁在变强”，再看到“当前谁最高分”。
- 首页仍展示具体分数，但只展示前 10 名左右，并压缩为最多 2 行。
- 新增 `S+ / S / A+ / A / B+ / B / C+ / C` 等级分段展示。
- 等级分段内不按历史总分排序，而按近期新增开源贡献带来的成长排序。
- 成长榜必须覆盖所有等级段，包括 `C` 级；低分用户只要近期有真实公开贡献，也应该能在自己等级段内被看见。
- 让更多用户有短期可见的进步反馈，形成复访动机。
- 避免鼓励刷提交，增长排序必须依赖有质量约束的公开开源代码信号。

## 首页信息架构

### 1. 近期成长 / 成长榜

- 展示位置：放在首页传统排行榜上方，作为首页主要动态模块。
- 展示名称建议：
  - `近期成长`
  - `成长榜`
  - `开源成长榜`
  - `本周进步开发者`
- 核心信息：
  - 不是展示谁分数最高，而是展示各等级段里近期真实开源贡献增长最明显的人。
  - 用户即使当前只有 `C` 级，只要近期有有效提交、PR、跨 repo 贡献或评分提升，也可以在 `C` 段成长榜出现。
  - 首页应传达“每天回来能看到新的进步者”，避免只看一次固定高分榜。
- 分段：
  - `全部`
  - `S+`
  - `S`
  - `A+`
  - `A`
  - `B+`
  - `B`
  - `C+`
  - `C`
- 首页默认展示方式：
  - 使用 tabs / segmented control 切换等级段。
  - `全部` 是独立视图，不是简单把所有卡片混在一起；点击后展示成长轨迹统计图。
  - 默认选中当前数据最活跃的等级段，或选中 `A` / `B+` / `C+` 这种更大众的段位。
  - 每段展示 6-12 个用户。
  - 每张卡片展示：
    - 头像、用户名、当前分数、等级。
    - 近期成长值，例如 `+3.2`。
    - 近期新增公开提交数。
    - 近期主要项目或语言标签。
    - 最近活跃时间。

### 1.1 全部视图：成长轨迹图

`全部` 选项用于表达“站内最近整体有哪些人在成长”，不按单个分段列表展示，而是做成一个二维统计图：

- 横轴：按日时间，建议默认最近 30 天。
- 纵轴：分数或等级分段位置。
  - 初版可以使用 `final_score` 的 0-100 纵向刻度。
  - 后续可以在纵轴旁显示 `C / C+ / B / B+ / A / A+ / S / S+` 分段辅助线。
- 图中节点：使用用户头像作为点位。
  - 每个头像代表某个用户在某天的最近扫描/快照位置。
  - 同一天同分数附近头像重叠时，需要做轻微散布或聚合气泡，避免完全盖住。
  - 高密度时可以先显示 Top N 成长用户，或按 `growth_score` 采样。
- 鼠标焦点 / hover：
  - 显示悬浮信息卡。
  - 包含头像、用户名、当前分段、近期贡献增长、合并 PR、影响提交、最近扫描时间。
  - 点击头像进入用户详情页。
- 移动端：
  - 支持横向滑动图表，或降级为“按日期分组的头像列表”。
  - tooltip 改为点击头像后出现 bottom sheet / popover。
- 空状态：
  - 没有足够快照时显示“暂无足够成长轨迹数据”，并引导用户重新扫描账号。

这个视图的意义不是排名，而是让用户直观看到“最近每天都有人从不同段位往上移动”，强化实时性和复访动机。

### 2. 顶部最佳开发者

- 展示名称：`最佳开发者` 或 `Top Developers`
- 数据范围：全站评分前 10。
- UI 要求：
  - 尽量 2 行显示完。
  - 单项只展示头像、用户名、分数、tier。
  - 不展示长描述，不占据首页主要高度。
  - 点击进入用户详情页。
- 用途：
  - 保留荣誉感。
  - 给新用户建立评分体系可信度。
  - 不再让它主导首页内容。

## 等级分段规则

需要先把现有分数映射为稳定等级，不改变原有评分，只增加展示层。

建议初版分段：

| 等级 | 分数范围 |
| --- | --- |
| S+ | 95-100 |
| S | 90-94.99 |
| A+ | 85-89.99 |
| A | 80-84.99 |
| B+ | 75-79.99 |
| B | 70-74.99 |
| C+ | 60-69.99 |
| C | 0-59.99 |

`C` 级不是失败态，而是成长榜的重要入口：这个段位的人最容易通过短期真实贡献获得反馈，因此必须可筛选、可展示、可上榜。

待确认：

- 是否保留当前 `tier` 命名，并将新等级作为 `growth_band`。
- 还是直接把新等级作为首页主展示等级。
- 老评分页是否同步展示该等级。

## 成长排序规则

核心原则：不按等级段内总分排序，而按近期新增公开开源贡献带来的可信增长排序。

### 初版 growth score 输入信号

建议使用最近 7 天和 30 天两个窗口：

- 最近新增 commit 数。
- 最近参与的公开 repo 数。
- 最近 PR 数。
- 最近 merged PR 数。
- 最近贡献 repo 的 star 权重。
- 最近新增语言/项目 facet。
- 最近评分变化值。
- 最近从不活跃变为活跃的恢复信号。


### 质量约束

避免刷榜：

- 单一 repo 的重复小 commit 需要降权。
- bot-like commit message 或超高频提交需要降权。
- fork / template / generated repo 贡献需要降权。
- 只统计公开 repo。
- 同一天过量提交需要 capped。
- merged PR、跨项目贡献、被 star 的 repo 权重更高。

### 初版排序公式草案

不需要一次做复杂，先做可解释版本：

```text
growth_score =
  score_delta_30d * 4
  + min(new_commits_7d, 30) * 0.25
  + min(new_prs_30d, 10) * 1.5
  + min(merged_prs_30d, 8) * 2
  + min(active_public_repos_30d, 6) * 1.2
  + impact_repo_bonus
  - suspicious_activity_penalty
```

待完成：

- 明确定义 `score_delta_30d` 来源。
- 明确定义 `impact_repo_bonus`。
- 明确定义 `suspicious_activity_penalty`。

## 数据模型 TODO

### 1. 新增评分快照或复用现有快照

检查现有表：

- `scores`
- `profile_snapshots`
- `developer_facets`
- `account_stats`

需要确认是否已有足够历史数据计算 7d / 30d 增长。如果不足，需要补：

- `score_snapshots`
  - `username`
  - `final_score`
  - `tier`
  - `scanned_at`
  - `commit_count`
  - `pr_count`
  - `merged_pr_count`
  - `active_repo_count`
  - `impact_repo_count`

### 2. 新增 growth leaderboard 聚合表

建议新增：

```text
growth_leaderboard_entries
```

字段：

- `username`
- `band`
- `final_score`
- `score_delta_7d`
- `score_delta_30d`
- `growth_score`
- `new_commits_7d`
- `new_prs_30d`
- `merged_prs_30d`
- `active_public_repos_30d`
- `primary_language`
- `primary_repo`
- `updated_at`

原因：

- 首页不能每次实时扫 GitHub。
- 需要缓存和分页。
- 方便按等级段读取。

## API TODO

### 1. 顶部最佳开发者 API

可复用现有 leaderboard API，但需要支持：

```text
GET /api/leaderboard?limit=10&compact=1
```

返回字段只保留首页需要的内容：

- username
- avatar_url
- final_score
- tier / band
- rank

### 2. 成长榜 API

新增或扩展：

```text
GET /api/growth-leaderboard?band=A&window=30d&limit=12
```

返回：

- band 列表统计。
- `band=all` / `view=timeline` 时返回图表点位数据，而不是卡片列表。
- 当前 band 用户列表。
- 更新时间。
- 每个用户的增长原因摘要。
- `band=C` 必须是合法查询，不能因为低分段被过滤掉。

示例：

```json
{
  "window": "30d",
  "band": "A",
  "updated_at": 1780000000000,
  "bands": [
    { "band": "S+", "count": 12 },
    { "band": "S", "count": 38 }
  ],
  "entries": [
    {
      "username": "octocat",
      "avatar_url": "...",
      "final_score": 83.2,
      "band": "A",
      "growth_score": 18.4,
      "score_delta_30d": 2.1,
      "new_commits_7d": 14,
      "merged_prs_30d": 3,
      "primary_language": "TypeScript",
      "primary_repo": "owner/repo"
    }
  ]
}
```

### 3. 成长轨迹图 API

新增或扩展：

```text
GET /api/growth-leaderboard/timeline?window=30d&limit=120
```

或复用：

```text
GET /api/growth-leaderboard?band=all&view=timeline&window=30d&limit=120
```

返回字段：

- `window`
- `updated_at`
- `points`
  - `username`
  - `display_name`
  - `avatar_url`
  - `band`
  - `final_score`
  - `growth_score`
  - `contribution_delta`
  - `merged_pr_delta`
  - `impact_commit_delta`
  - `snapshot_at`
  - `primary_language`
  - `primary_repo`

示例：

```json
{
  "window": "30d",
  "updated_at": 1780000000000,
  "points": [
    {
      "username": "octocat",
      "avatar_url": "...",
      "band": "A",
      "final_score": 83.2,
      "growth_score": 18.4,
      "contribution_delta": 14,
      "merged_pr_delta": 3,
      "impact_commit_delta": 2,
      "snapshot_at": 1780000000000,
      "primary_language": "TypeScript",
      "primary_repo": "owner/repo"
    }
  ]
}
```

注意：图表可以内部使用 `final_score` 作为纵轴坐标，但 UI tooltip 和列表仍应优先显示分段等级与成长原因，不要把“具体分数”重新变成成长榜的主视觉。

## 首页 UI TODO

### 1. 新增成长榜组件

建议组件名：

```text
HomeGrowthLeaderboard
```

位置：

- 放在现有最佳开发者排行榜上方。
- 作为首页更高优先级模块，占据主要视线区域。
- 传统 Top 10 排行榜下移并压缩，避免首页一直被固定高分用户占据。

状态：

- loading
- empty
- error
- band selected
- window selected

交互：

- 点击 band 切换。
- 点击 `全部` 切换到成长轨迹图。
- `S+ / S / A+ / A / B+ / B / C+ / C` 全部分段都可选。
- `C` 段有数据时正常展示；没有数据时显示“暂无 C 段成长数据”，不能隐藏整个 C 段入口。
- 点击用户进详情页。
- 可选：`查看我的等级`，引导用户输入 GitHub 用户名评分。

视觉：

- 用等级色标，但避免全页面变成单一色系。
- 每个 entry 重点展示 `+growth`，不是只展示分数。
- 文案强调“近期公开贡献”，避免误解为终身排名。

### 1.1 成长轨迹图组件

建议组件名：

```text
GrowthTimelineChart
```

职责：

- 在成长榜 `全部` tab 下渲染。
- 横轴按日期分桶。
- 纵轴按分数区间或等级段位置。
- 使用头像作为散点节点。
- hover / focus 显示 tooltip。
- 支持键盘 focus，不能只有鼠标 hover。
- 支持节点点击进入用户详情。

实现建议：

- 初版可以用 SVG 实现，便于头像 clipPath、tooltip 和响应式布局。
- 如果数据量较大，再考虑 canvas 或虚拟化。
- 头像加载失败时降级为用户名首字母或 GitHub 默认头像。
- 节点需要设置最小点击区域，移动端不要低于 36px。
- 重叠处理：
  - 同一天同分段内按 `growth_score` 排序。
  - 前几个头像直接展示。
  - 其余聚合为 `+N` 气泡。
  - hover 聚合气泡时展示该桶内用户列表。

### 2. 压缩现有排行榜

- 找到首页使用的 leaderboard 组件。
- 增加 compact 模式。
- 桌面端最多 2 行。
- 移动端可以横向滚动或 2 列网格。
- 降低视觉权重，把主要空间让给成长榜。

## 数据刷新策略 TODO

### 初版

- 用户被扫描或重新锐评时，写入快照。
- 首页读取已有聚合数据。
- 没有聚合时 fallback 到现有 scores。

### 后续

- 定时任务每天刷新活跃用户。
- 对最近被查询、最近上榜、最近加入圈子的用户优先刷新。
- 低活跃用户降低刷新频率。

## 反作弊 TODO

- 添加每日 commit cap。
- 检测异常重复 commit message。
- 检测单一 repo 过量提交。
- 降权 fork/template/generated repo。
- 排除明显 bot 账号。
- 增加“质量贡献”权重，例如 merged PR、被维护者接受、跨 repo 贡献。

## SEO / 文案 TODO

首页文案方向：

- 不要只说“谁最强”。
- 强调“最近谁在变强”。
- 强调“公开代码成长记录”。

建议文案：

- `最佳开发者只是起点，近期成长才是每天值得回来的理由。`
- `按等级段看正在进步的人，而不是永远只看同一批满级账号。`
- `增长榜基于近期公开开源提交、PR 和评分变化，不鼓励刷提交。`

## 验收标准

- 首页模块顺序为：成长榜在上，最佳开发者 Top 10 在下。
- 首页最佳开发者只展示前 10，并在桌面端最多 2 行。
- 首页存在 S+/S/A+/A/B+/B/C+/C 分段入口。
- 成长榜存在 `全部` 入口，点击后展示横轴按日、纵轴按分数/分段的头像轨迹图。
- 成长轨迹图 hover/focus 头像时展示悬浮信息，点击头像进入用户详情页。
- 每个等级段内按 `growth_score` 排序，而不是按 `final_score` 排序。
- `C` 段用户可以进入成长榜，且 `band=C` API 查询能返回有效数据或合理 empty 状态。
- 用户近期有真实公开贡献后，重新扫描可以影响其成长排序。
- 没有足够历史数据时页面不崩溃，并显示合理 empty/fallback。
- `pnpm typecheck` 通过。
- 相关组件 lint 通过。
- `pnpm build` 通过。

## 实施顺序

1. 梳理现有首页 leaderboard 数据流。
2. 定义 score 到 band 的映射函数。
3. 定义 growth score 计算函数和单元测试。
4. 增加或复用快照数据。
5. 增加 growth leaderboard 查询 API。
6. 增加成长轨迹图 API 或 `band=all&view=timeline` 响应。
7. 首页压缩 Top 10 展示。
8. 首页接入等级分段成长榜。
9. 首页接入 `全部` 轨迹图视图。
10. 补充 empty/error/loading 状态。
11. 增加反作弊降权。
12. 跑 typecheck、lint、test、build。

## 开放问题

- 成长榜窗口默认用 7 天还是 30 天？
- 等级段是否要和现有 `tier` 完全绑定？
- 对没有历史快照的老用户，是否允许用第一次扫描作为 baseline？
- 是否需要给登录用户展示“你所在等级段的位置”？
- 是否需要把成长榜扩展到独立页面，而不仅在首页展示？
- `全部` 轨迹图的纵轴初版用 0-100 分数，还是直接用等级段离散轴？
- 轨迹图高密度时优先聚合，还是只显示成长分最高的前 N 个用户？
