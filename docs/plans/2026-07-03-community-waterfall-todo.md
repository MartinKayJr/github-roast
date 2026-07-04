# 社区圈子瀑布流待完成事项

## 背景定位

社区圈子不应该是另一个排行榜，而应该是“发现值得认识的人”的信息流。`developers` 负责按标签/榜单检索，`community` 负责像星球社区一样让用户遇到同圈层、同兴趣、同项目方向的人。

核心目标：

- 让用户通过 GitHub 公开信号和社区档案发现同圈子的人。
- 让“锐评”从上榜评分延展到“认领自己、找到伙伴、进入圈子”。
- 尽量不用 LLM 生成基础推荐，避免成本和刷接口风险。
- LLM 只做增强：推荐理由、自然语言找人、个性化总结。

## 第一阶段：社区瀑布流 MVP

### 页面入口

- [ ] 新增 `/[locale]/community` 页面。
- [ ] 导航栏新增 `社区` / `Community` 入口。
- [ ] 用户主页社区档案卡片增加 `逛社区` 入口。
- [ ] 对战页右侧预留 `相关圈子` 模块，先复用社区推荐卡片。

### 信息架构

- [ ] `/community` 首屏直接展示推荐瀑布流，不做营销 landing。
- [ ] 顶部提供轻量筛选：
  - [ ] `推荐`
  - [ ] `同技术栈`
  - [ ] `开源协作`
  - [ ] `AI / 工具`
  - [ ] `基础设施`
  - [ ] `前端体验`
  - [ ] `随机探索`
- [ ] 提供搜索框，第一版使用标签/用户名关键词搜索，不接 LLM。
- [ ] 已登录用户显示“基于你的社区档案推荐”提示状态。
- [ ] 未登录用户显示全站公共推荐流。

### 推荐卡片

每张卡片建议包含：

- [ ] GitHub 头像。
- [ ] 用户名和展示名。
- [ ] 评分徽章，弱化排名，不显示大号名次。
- [ ] 2-4 个圈子标签：
  - 语言标签，例如 `TypeScript`、`Rust`
  - 项目标签，例如 `dify`、`next.js`
  - 组织标签，例如 `vercel`、`apache`
  - 主题标签，例如 `AI tools`、`infra`
- [ ] 社区档案字段：
  - `我在做什么`
  - `想认识谁`
- [ ] 推荐理由：
  - 第一版规则生成，例如“同属 TypeScript / AI tools 圈子”
  - 第二版可由 AI 生成更自然的文本
- [ ] 操作按钮：
  - `查看主页`
  - `加入对战`
  - `收藏`，可后置
- [ ] 如果用户未认领社区档案但有公开评分，可显示较弱卡片：
  - 使用公开 GitHub 信号生成“可能方向”
  - 不展示社交意图字段

### 瀑布流布局

- [ ] 桌面端：2-3 列瀑布流，卡片高度可变。
- [ ] 窄屏桌面或对战右栏：单列信息流。
- [ ] 移动端：单列，卡片间距紧凑。
- [ ] 加载更多使用 cursor pagination，不一次性加载大量数据。
- [ ] 初始加载 skeleton，不使用大面积空白。
- [ ] 卡片文案必须防溢出，长文本最多展示 3-4 行并可展开。

## 第二阶段：推荐数据与接口

### 数据来源

优先使用现有数据：

- `scores`
  - 分数、tier、头像、展示名、profile_url。
- `developer_facets`
  - language / repo / org 标签。
- `profile_snapshots`
  - top repos、impact repos、topics、organizations、pinned repos。
- `community_profiles`
  - 社区档案、可见性、状态。
- `sub_scores`
  - 画像相似度，后续用于个性化推荐。

### 新增 DB 查询

- [ ] 新增 `getCommunityFeed(input)`。
- [ ] 支持参数：
  - `viewerLogin?: string`
  - `viewerGithubId?: number`
  - `mode?: "recommended" | "same_stack" | "open_source" | "ai_tools" | "infra" | "frontend" | "explore"`
  - `query?: string`
  - `cursor?: string`
  - `limit?: number`
- [ ] 返回结构：
  - 用户基础信息
  - 社区档案字段
  - 圈子标签
  - 推荐原因
  - cursor
- [ ] 只返回：
  - `community_profiles.status = active`
  - `visibility = public`
  - 或者没有社区档案但评分达标的公共开发者，需明显标记为 `unclaimed`
- [ ] 默认优先已认领且档案完整的人。

### API 设计

- [ ] 新增 `GET /api/community/feed`。
- [ ] 查询参数：
  - `mode`
  - `q`
  - `cursor`
  - `limit`
- [ ] 响应示例：

```json
{
  "items": [
    {
      "username": "example",
      "displayName": "Example",
      "avatarUrl": "https://...",
      "score": 82.4,
      "tier": "顶级",
      "claimed": true,
      "tags": ["TypeScript", "AI tools", "vercel"],
      "workingOn": {"zh": "...", "en": "..."},
      "wantToMeet": {"zh": "...", "en": "..."},
      "reason": {"zh": "同属 TypeScript / AI tools 圈子", "en": "Shared TypeScript / AI tools circles"}
    }
  ],
  "nextCursor": "..."
}
```

### 缓存与风控

- [ ] Redis 缓存公共 feed：
  - key: `community:feed:{mode}:{query}:{cursor}:{limit}`
  - TTL: 5-10 分钟
- [ ] 登录用户个性化 feed 短缓存：
  - key: `community:feed:user:{githubId}:{mode}:{cursor}`
  - TTL: 1-3 分钟
- [ ] API 默认 `limit <= 30`。
- [ ] 搜索关键词做长度限制和规范化。
- [ ] 不在 feed API 内调用 LLM。

## 第三阶段：推荐算法

### MVP 规则推荐

按多个池子混排：

- [ ] 共同圈子池：
  - 和当前用户共享语言/项目/组织标签。
- [ ] 相似画像池：
  - 使用 `sub_scores` 距离，复用现有相似开发者逻辑。
- [ ] 社区活跃池：
  - 已认领社区档案、公开、字段完整。
- [ ] 高质量探索池：
  - 评分高、标签丰富、最近被查询或近期活跃。
- [ ] 冷启动池：
  - 未登录用户使用热门公共圈子混排。

### 排序权重建议

第一版可以用规则分：

- 已认领社区档案：+30
- 和用户共享语言标签：每个 +8
- 共享项目标签：每个 +12
- 共享组织标签：每个 +10
- 社区档案字段完整：+10
- 分数 60+：基础入池
- 分数 80+：+8
- 最近扫描/最近活跃：+5
- 已经看过的人：降权或过滤，后续实现

### 推荐理由生成

第一版规则生成：

- [ ] `你们都关注 {language} / {topic}`
- [ ] `TA 和你都出现在 {org} / {repo} 圈子`
- [ ] `TA 的社区档案也在寻找 {intent}`
- [ ] `TA 更偏 {focus}，适合扩展你的圈子`

第二版 AI 增强：

- [ ] 增加批量离线/缓存式推荐理由生成，不在每次 feed 请求实时跑 LLM。
- [ ] 每个用户每天最多刷新一次 AI 推荐理由。
- [ ] 推荐理由必须基于返回给模型的结构化标签和社区档案，不能编造私人信息。

## 第四阶段：对战页右侧相关圈子

### 模块定位

对战页右侧的圈子不是完整社区页，而是基于 A/B 两个开发者上下文的推荐流。

### 内容

- [ ] 标题：`相关圈子` / `Related circles`
- [ ] 展示 6-12 张推荐卡片。
- [ ] 推荐池：
  - A 和 B 共同标签下的人。
  - 更像 A 的人。
  - 更像 B 的人。
  - 横跨 A/B 差异圈子的人。
- [ ] 每张卡片增加上下文推荐理由：
  - `和 A 都关注 AI tools`
  - `和 B 都有 Rust / infra 信号`
  - `连接两边：TypeScript + infra`
- [ ] 提供 `查看更多圈子` 跳转 `/community?from=vs&a=...&b=...`

### API

- [ ] 可以复用 `/api/community/feed`，增加：
  - `context=vs`
  - `a=username`
  - `b=username`
- [ ] 或新增 `GET /api/community/related?v=...`，后续再决定。

## 第五阶段：用户交互

### 轻互动

- [ ] 收藏开发者。
- [ ] 不感兴趣。
- [ ] 复制主页链接。
- [ ] 加入对战。

### 认领转化

- [ ] 未登录用户点击“加入社区”触发 GitHub 登录。
- [ ] 登录但未锐评用户：引导先锐评自己。
- [ ] 已锐评但未认领用户：打开社区档案弹窗，展示自动草稿。
- [ ] 已认领用户：可编辑档案，回到社区流后优先展示完整卡片。

### 后续社交功能预留

- [ ] 关注用户。
- [ ] 收藏圈子。
- [ ] 私密备注。
- [ ] “想认识 TA”轻量意向按钮。
- [ ] 双向意向后再开放联系方式，避免骚扰。

## 第六阶段：i18n 与文案

需要新增 message keys：

- [ ] `communityPage.title`
- [ ] `communityPage.subtitle`
- [ ] `communityPage.tabs.recommended`
- [ ] `communityPage.tabs.sameStack`
- [ ] `communityPage.tabs.openSource`
- [ ] `communityPage.tabs.aiTools`
- [ ] `communityPage.tabs.infra`
- [ ] `communityPage.tabs.frontend`
- [ ] `communityPage.tabs.explore`
- [ ] `communityPage.searchPlaceholder`
- [ ] `communityPage.empty`
- [ ] `communityPage.loadMore`
- [ ] `communityCard.workingOn`
- [ ] `communityCard.wantToMeet`
- [ ] `communityCard.reason`
- [ ] `communityCard.viewProfile`
- [ ] `communityCard.challenge`
- [ ] `communityCard.unclaimed`
- [ ] `communityCard.claimed`
- [ ] `communityRelated.title`
- [ ] `communityRelated.more`

## 第七阶段：验收标准

### 功能验收

- [ ] `/community` 可以打开。
- [ ] 未登录也能看到公共推荐瀑布流。
- [ ] 登录且已认领用户看到更贴近自己的推荐。
- [ ] 点击卡片能进入用户主页。
- [ ] 点击加入对战能进入 `/vs` 或预填对战入口。
- [ ] 社区档案私密用户不会出现在公共流。
- [ ] 未认领用户不会展示社交意图字段。
- [ ] 加载更多能稳定分页，不重复大量用户。

### 技术验收

- [ ] `pnpm typecheck` 通过。
- [ ] targeted eslint 通过。
- [ ] `pnpm test src/messages/__tests__/messages.test.ts` 通过。
- [ ] `pnpm build` 通过。
- [ ] feed API 不实时调用 LLM。
- [ ] feed DB 查询有 limit、cursor、缓存。
- [ ] 不提交任何 `.env`、token、key。

### 产品验收

- [ ] 页面观感是社区信息流，不像排行榜。
- [ ] 卡片能快速回答“这个人是谁、在做什么、适合认识吗”。
- [ ] 推荐理由可解释，不玄学。
- [ ] 对战页相关圈子能自然把用户导向社区瀑布流。

## 推荐开发顺序

1. 先做 `/api/community/feed` 的规则推荐，不做页面。
2. 做 `/community` 单列/双列瀑布流页面。
3. 接入社区卡片和加载更多。
4. 把导航入口和用户主页入口补齐。
5. 把对战页右侧接入 `相关圈子`。
6. 做收藏/不感兴趣等轻互动。
7. 最后再做 AI 推荐理由和自然语言社区搜索。
