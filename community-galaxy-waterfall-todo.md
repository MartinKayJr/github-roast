# Community Galaxy Waterfall TODO

## Goal

把圈子页从“雷达 + 普通卡片列表”升级为一个可滚动的星域瀑布流：

- 每个瀑布流单元是一个领域/圈子星球，不只是一个用户卡片。
- 星球进入视口时，通过 canvas 粒子先凝聚成主星球，再形成行星环，最后几个强相关成员节点放大并切换成头像。
- 页面整体仍保留宏观粒子星域背景，但每个领域卡的动画独立懒加载、离屏暂停，避免性能失控。

## UX Shape

### 1. Page Layout

- `/community` 顶部保留一片主星域，用来表达当前探索目标：
  - 登录后：中心是当前用户。
  - 未登录：中心是公共圈子探索。
  - 后续：中心也可以是某个领域、技术栈、组织、兴趣圈子。
- 主星域下方是领域星球瀑布流。
- 不再把“圈子”主要表现为普通卡片列表，而是让每个领域卡片本身成为一个小星系。

### 2. Domain Planet Card

每个领域星球块包含：

- 粒子主星球。
- 1-2 层粒子行星环。
- 3-6 个代表成员头像节点。
- 极少量文字：
  - 领域名。
  - 成员数。
  - 匹配原因一句话。
  - 标签 2-4 个。
  - “探索领域 / 加入圈子 / 订阅推荐”按钮。

### 3. Scroll Formation Animation

进入视口时不是突然出现卡片，而是按状态逐步形成：

1. `idle`
   - 离视口较远。
   - 不初始化 canvas。
   - 只渲染轻量占位容器。

2. `preload`
   - 距离视口约 600px。
   - 开始加载领域数据和头像。
   - 初始化低粒子数量 canvas。

3. `forming`
   - 进入视口。
   - 粒子从四周向中心收束，形成主星球。
   - 持续约 600-900ms。

4. `orbiting`
   - 粒子环逐渐形成。
   - 强相关成员节点仍以亮点形式存在。
   - 持续约 300-500ms。

5. `revealed`
   - 3-6 个节点逐渐放大。
   - 节点从光点切换为头像。
   - 文案和按钮淡入。

6. `paused`
   - 离开视口。
   - 暂停 `requestAnimationFrame`。
   - 保留最后一帧或静态缩略图。

## Data Model

### Tables

#### `circle_domains`

领域/圈子定义。

```sql
CREATE TABLE IF NOT EXISTS circle_domains (
  slug          TEXT PRIMARY KEY,
  name_zh       TEXT NOT NULL,
  name_en       TEXT,
  description_zh TEXT,
  description_en TEXT,
  source        TEXT NOT NULL DEFAULT 'facet' CHECK(source IN ('facet', 'ai', 'admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'hidden')),
  member_count  INTEGER NOT NULL DEFAULT 0,
  heat_score    REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

#### `circle_domain_members`

用户属于哪些领域，以及权重。

```sql
CREATE TABLE IF NOT EXISTS circle_domain_members (
  domain_slug TEXT NOT NULL,
  login       TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 0,
  reason_zh   TEXT,
  reason_en   TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY(domain_slug, login)
);
```

#### `circle_domain_edges`

领域之间的关联，用于后续领域跳转和星系图。

```sql
CREATE TABLE IF NOT EXISTS circle_domain_edges (
  from_slug TEXT NOT NULL,
  to_slug   TEXT NOT NULL,
  weight    REAL NOT NULL DEFAULT 0,
  reason    TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(from_slug, to_slug)
);
```

## Data Generation

### Phase 1: Facet-Based Domains

先不依赖 AI。

- 从 `developer_facets` 聚合领域：
  - `language:*`
  - `org:*`
  - `repo:*`
- 每个 facet bucket 生成一个 `circle_domain`。
- 领域成员来自对应 facet 下的 community profile / score。
- 排序规则：
  - 活跃公开社区成员优先。
  - 评分高但近期有成长者优先。
  - 有完整社区档案者优先。

### Phase 2: AI-Merged Domains

后续再接 AI，把碎片 facet 合并成更自然的人群：

- “AI 应用开发者”
- “Rust 基建维护者”
- “前端工程化”
- “开源工具作者”
- “LLM Infra”
- “独立开发者”

AI 只做离线/后台归类，不在滚动时实时调用。

## API

### `GET /api/community/domains`

返回瀑布流领域列表。

Query:

- `cursor`
- `limit`
- `viewerLogin`
- `mode`: `recommended | hot | new`

Response:

```ts
type CommunityDomain = {
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  heatScore: number;
  tags: string[];
  matchReason: string | null;
  members: Array<{
    login: string;
    avatarUrl: string | null;
    tier: Tier;
    finalScore: number;
  }>;
};
```

### `GET /api/community/domains/[slug]`

领域详情页数据。

### `POST /api/community/domains/[slug]/join`

加入/关注领域。

需要登录。

## Components

### `CommunityGalaxyWaterfall`

职责：

- 拉取领域列表。
- 管理分页和无限滚动。
- 控制最多同时运行的 canvas 数量。
- 把数据传给 `GalaxyDomainCard`。

### `GalaxyDomainCard`

职责：

- 单个领域星球卡。
- 内部用 canvas 绘制：
  - 星尘。
  - 主星球凝聚。
  - 行星环。
  - 成员节点光点。
  - 粒子流。
- DOM 层只负责：
  - 点击区域。
  - 头像覆盖层。
  - 少量文案和按钮。

### `useGalaxyCardVisibility`

职责：

- `IntersectionObserver`。
- 接近视口时切到 `preload`。
- 进入视口切到 `forming`。
- 离开视口切到 `paused`。
- 离开很远后释放 canvas。

### `GalaxyParticleEngine`

职责：

- 纯 canvas 动画引擎。
- 不依赖 React state 每帧更新。
- 提供：
  - `start()`
  - `pause()`
  - `destroy()`
  - `setPhase(phase)`
  - `resize()`

## Performance Rules

- 全页背景 canvas：最多 1 个。
- 瀑布流卡片 canvas：同时最多运行 3-5 个。
- 离屏卡片暂停 RAF。
- 离屏很远的卡片销毁 canvas，仅保留静态占位。
- 移动端降低粒子数：
  - desktop: 120-220 particles/card
  - mobile: 60-120 particles/card
- DPR 限制：
  - page background: `Math.min(devicePixelRatio, 1.5)`
  - card canvas: `Math.min(devicePixelRatio, 1.5)`
- `prefers-reduced-motion`：
  - 不播放凝聚动画。
  - 直接显示静态星球 + 成员头像。
  - 粒子数量降低到 30%-40%。

## Implementation Phases

### Phase A: Static Domain Cards

- 新增 `circle_domains` 相关 DB helper。
- 从 `developer_facets` 生成第一批领域。
- 新增 `/api/community/domains`。
- 做普通领域卡片瀑布流，不上动画。

### Phase B: Canvas Card Animation

- 新增 `GalaxyDomainCard`。
- 做 `idle -> preload -> forming -> orbiting -> revealed -> paused` 状态机。
- 只在 mock 数据上验证动画。

### Phase C: Real Data Integration

- 把真实领域数据接入 `CommunityGalaxyWaterfall`。
- 每张卡展示 3-6 个代表成员。
- 支持分页懒加载。

### Phase D: Domain Detail Page

- 新增 `/community/[slug]`。
- 中心星球是领域。
- 周围是领域成员。
- 支持加入/订阅/站内信推荐。

### Phase E: AI Domain Merge

- 后台任务把 facet bucket 合并成自然领域。
- AI 只写数据库，不参与滚动实时请求。
- 每个领域生成：
  - 名称。
  - 描述。
  - 匹配理由模板。
  - 相邻领域。

## Acceptance Criteria

- `/community` 首屏有全页粒子星域背景。
- 下方瀑布流每个领域卡进入视口时会凝聚成星球。
- 卡片动画不会导致页面滚动卡顿。
- 同时运行的卡片 canvas 不超过配置上限。
- 离屏卡片暂停。
- `prefers-reduced-motion` 下可用。
- 移动端可用。
- 未登录用户可以浏览领域。
- 登录用户可以加入/订阅领域。
- 未来可以把中心从“用户”切换为“领域/圈子”。
