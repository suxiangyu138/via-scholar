# CLAUDE.md

技术说明，供后续开发参考。

## 产品

**问道 Via Scholar** 是面向 K12 教师与学生的全学科教学智能体，Agent 名 **Pathfinder**，模型只用 **DeepSeek**。

- 学生：分步解题、概念讲解、错题订正、同类练习
- 教师：教学目标、课堂引入、例题与变式、易错点、分层作业
- 学段：小学、初中、高中；全学科（语数英、理化生、政史地、科学、信息科技、通用技术及素质课程），不因学科拒答
- RAG 已从产品下线，`com.chatbot.rag` 代码保留但不参与对话

## 构建与运行

Java 25 / Maven 3.9+：

```bash
mvn -DskipTests package
java -jar target/via-scholar-4.1.0.jar

# 或
mvn spring-boot:run
```

默认监听 `127.0.0.1:8080`，无自动化测试。

## 请求流

```text
POST /api/attachments (multipart, 最多 50 个)
  → AttachmentService 落盘 data/uploads，返回附件 ID

POST /api/chat { messages, attachments:[id], deepThinking, webSearch,
                 stage, subject, role, textbook }
  → ChatController
  → ChatService（读取历史、注入教学上下文、拼接 SYSTEM_PROMPT、计时、落库）
      附件：PDF/文本 → 拼入用户文本；图片 → data URL content parts
      webSearch=true → DeepSeekApiClient.search() 调 /v1/tools/search
                      → 搜索摘要作为外部资料追加进系统提示词
      短追问/纯客套不触发搜索；搜索失败不阻断对话
  写入用户消息（历史接口返回 msgId）
  → DeepSeekAdapter.streamChat
      stream_options.include_usage = true
      thinking: disabled（默认）或 enabled + reasoning_effort: high
  → SSE: reasoning / chunk / finish / error
```

## 附件约束

- 支持图片（png/jpg/jpeg/webp/gif）、PDF、txt/md/csv/json/html/tex/log
- 每条消息最多 50 个；单文件 20MB，总量 100MB，图片总量 25MB
- 图片仅 `deepseek-flash` 支持；`deepseek-v4-pro` 为纯文本，前端会阻止带图片发送
- PDF 只提取文本（最多 50 页），扫描版建议上传图片
- 历史消息只保存用户文字，不保存附件内容；附件文件临时存放在 `data/uploads`，24 小时清理
- Tomcat `server.tomcat.max-part-count=100`，否则 50 个附件会触发 413

## 约束

- `chunk` / `reasoning` 只发送增量；`finish` 才带 `fullContent`、`fullReasoning`、`metrics`
- `UnifiedStreamChunk` 使用 `@JsonInclude(NON_NULL)`，空字段不输出
- `metrics` 字段由 `assets/app.js` 的 `renderMetrics` 消费，改名需同步前端
- `ttftMs` 从上游调用前开始计时；`outputTps = completionTokens / (结束 - 首 token)`
- API Key 只从浏览器随请求传入，不落盘、不写日志

## DeepSeek 接口

| 接口 | 用途 |
|------|------|
| `POST /api/attachments` | 上传附件，返回 ID |
| `DELETE /api/attachments/{id}` | 删除未发送附件 |
| `POST /api/deepseek/models` | 代理 `GET {root}/models` |
| `POST /api/deepseek/balance` | 代理 `GET {root}/user/balance` |
| `POST /v1/tools/search` | 由 `ChatService` 直接调用，使用用户 API Key，结果不持久化 |
| `POST /api/chat` | 流式对话；`deepThinking` 默认 false，`webSearch` 默认 true |

`DeepSeekApiClient.apiRoot()` 会去掉末尾 `/`、`/v1` 或 `/chat/completions`，再拼接 `/models`、`/user/balance`、`/v1/tools/search`；对话仍使用用户填写的 baseUrl + `/chat/completions`。Search 与模型共用同一个 API Key，按 DeepSeek Search 官方规则计费。

## 前端状态

- 历史会话：H2 持久化；侧边栏“编辑”进入多选，支持全选、批量删除（`POST /api/history/sessions/delete`）
- 收藏：回答结束后“收藏”写入 `localStorage` 的 `viaScholarFavoritesV1`，侧边栏“我的收藏”可查看、复制、删除
- 个性化：`localStorage` 的 `viaScholarPersonalPromptV1`，每次对话作为 `customInstructions` 发送，服务端追加到系统提示词末尾并限制 2000 字
- 教学上下文：`localStorage` 的 `viaScholarTeachingContextV1`，保存学段/学科/身份/教材；请求字段 `stage`、`subject`、`role`、`textbook`，服务端拼入系统提示词
- 阅读字号：`localStorage` 的 `viaScholarAnswerFontSizeV1`，范围 12–22，默认 14；通过 `--answer-size` 控制 `.answer`、收藏正文和预览，标题/代码/表格用 em 跟随
- 讲义结构：回答标题使用 `##`，正文章节使用 `###`；`refreshAnswerStructure()` 计算阅读时长和目录，桌面端显示 `#toc-rail`，移动端 `#toc-overlay`
- 公式兜底：`repairMathDelimiters()` 在渲染前补齐未闭合的 `$`/`$$`，`repairLatexContent()` 补齐常见括号和 `\left/\right`；`renderPreparedMath()` 逐个公式调用 `katex.renderToString`，单个失败不会中断整篇。
- 教学组件：`decorateAnswer()` 只把代码块包成 `teaching-block` 并加复制按钮，公式/化学式保持普通块级排版；表格包 `table-wrap`，宽表格用 `width:max-content` + 横向滚动并在溢出时插入提示；引用链接汇总到 `answer-sources`；不生成易错点 callout，blockquote 使用普通文本样式
- 深度思考兜底：`finishOrFallback()` 发现 reasoning 非空、content 为空时，自动把 `deepThinking` 改为 false 再请求一次，避免 high/max 推理耗尽 8192 输出预算后显示空回答
- 教学动作：每条回答可发起“板书提纲 / 同类题 / 分层作业”，会作为新的用户请求发送，不修改原回答
- 历史搜索：`state.historyQuery` 过滤侧边栏会话；多选只作用于当前可见结果
- 首页快捷入口：讲一道题 / 备一节课 / 出一组题 / 自由提问；`state.startMode` 控制激活态和输入框 placeholder，`#starter-banner` 显示当前模式并可取消，不自动填写题目
- 首页滚动：`#chat-scroll.welcome-mode` 设置 `overflow-y:hidden`；移动端隐藏长介绍卡，改为三张紧凑卡，内容垂直居中，避免首页上下滑动
- 星空背景：`#starfield` 为首页 canvas，绘制粒子、星座连线、视差和流星；仅 `welcome-mode` 运行，离开首页停止，DPR 上限 2，`prefers-reduced-motion` 下只静态绘制
- 身份结构：提示词按“学生/教师”要求不同章节；身份来自顶部教学上下文条，通过 `role` 字段传入
- 深度思考：`localStorage` 的 `viaScholarDeepThinkingV1`，默认关闭；关闭时请求 `thinking:{type:"disabled"}`，开启时 `thinking:{type:"enabled"}` + `reasoning_effort:"high"`；输出预算按 8192 处理
- 联网搜索：`localStorage` 的 `viaScholarWebSearchV1`，默认开启；后端调用 DeepSeek `/v1/tools/search`，结果作为外部资料注入系统提示词，搜索失败不阻断对话
- 重新编辑/重新生成：用户消息带 `msgId`；先调用 `/api/history/messages/truncate` 截断该消息及后续，再重新发送或生成；错误框提供重试按钮
- 附件：`camera-input`（capture）、`album-input`（image/*）、`file-input`（仅 PDF/文本）三个入口；change 事件先 `Array.from(files)` 快照，再清空 input，避免 FileList 被清空
- 收藏迁移：旧 `mathErrorBook` 会在 `loadFavorites()` 时迁移到 `viaScholarFavoritesV1` 并删除旧键
- 回答标题：提示词要求每次回答以 `### 标题` 开头；前端用首个标题做收藏标题，收藏详情中不重复显示
- 滚动：`state.autoScroll` 记录是否跟随底部；用户上翻后停止自动滚动并标记新内容，`finishAi` 不再强制回底
- 导出：每条回答操作栏可导出 TXT / Word(原生 .docx) / PDF；TXT/Word 保留 LaTeX 源码，PDF 用 html2pdf 按需加载并保留公式、代码、表格排版；文件名为标题＋`YYYYMMDD_HHmmss_SSS`

## 渲染

- Markdown 先经 `marked` 解析，再用 KaTeX `renderMathInElement` 渲染公式，避免先替换公式破坏 Markdown。
- 已加载 `mhchem`，支持 `\ce{...}` 化学式/方程式；已加载 `auto-render`，支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`。
- 代码块按语言高亮，未标注语言时用 highlight.js 自动识别；代码块内的 `**`、`$` 不会被误处理。
- 中文标点后的 `**加粗**` 由前端预处理保证渲染；答案正文与标题左对齐。
- 回答首行支持 `<!--via-meta {"subject":"...","type":"...","grade":"..."}-->`，解析后显示类型标签，元数据不进入正文。
- 流式渲染用未闭合分隔符扫描：公式未闭合时显示“公式生成中”占位，代码未闭合时按纯文本显示，闭合后再走正常渲染。
- 推理区：流式阶段 `.think-body` 使用 pre-wrap；最终 Markdown 加 `.think-rendered` 改为 normal，避免 HTML 换行被当成大量空行。`appendThink()` 只在 details 展开时懒渲染，`MAX_THINK_RENDER=9000` 截断展示，避免长推理阻塞页面。

## 费用

`DeepSeekPricing` 按官方美元价（每百万 token）估算：

- `deepseek-flash`：命中 0.006/0.003，未命中 0.30/0.15，输出 1.20/0.60
- `deepseek-v4-pro`：命中 0.044/0.022，未命中 1.32/0.66，输出 3.96/1.98

斜线前为高峰价、后为低峰价。高峰为 UTC 周一至周五 `01:00-04:00`、`06:00-10:00`；未接入法定节假日。前端按 1 USD ≈ 7.1 CNY 折算为人民币，用 `≈¥` 表示估算，实际以账单为准。未知模型 `costUsd` 为 null。

## 前端

- `static/index.html`：结构
- `static/assets/app.css`：白底极简样式；1024px 以下侧边栏变抽屉，760px 以下收紧顶栏
- `static/assets/app.js`：配置、余额、模型弹层、附件/相机/相册/文件上传、SSE、Marked + KaTeX auto-render + mhchem + highlight.js、指标、历史多选、收藏、个性化提示词
- 外部 CDN：KaTeX、KaTeX mhchem/auto-render、highlight.js、marked；html2pdf 与 docx 按导出需求懒加载；DOMPurify 本地
- `localStorage`：`deepseekConfigV2`、`currentDbSessionId`、`viaScholarFavoritesV1`、`viaScholarPersonalPromptV1`、`viaScholarAnswerFontSizeV1`、`viaScholarDeepThinkingV1`、`viaScholarWebSearchV1`
- 旧配置会从 `modelConfigs.deepseek` 迁移，旧模型名映射到 `deepseek-flash` / `deepseek-v4-pro`；旧 `mathErrorBook` 仅用于收藏迁移

## 会话与数据

- `sid` 由 `POST /api/history/session/create` 写入 1 年 HttpOnly Cookie
- `chat_session.owner_sid` 做归属校验；`chat_message` 保存正文、思考过程、`usage_json` 和递增 `msgId`
- `GET /api/history/messages/{id}` 返回 `msgId`；`POST /api/history/messages/truncate` 删除从该消息起的全部消息，用于编辑/重新生成
- H2：`./data/chatbot-db.mv.db`；`ddl-auto=update`；附件在 `data/uploads`（24 小时清理），Lucene 索引在 `data/lucene_index`
- 无 DB 会话时回退到 `ChatService.sessions`；同一会话不要并发写入

## 安全边界

- 只监听本机；CORS 只允许 localhost
- `/api/chat` 30 次/分钟/IP；其他 `/api` 300 次/分钟
- Search 结果是外部不可信资料，只作为参考注入提示词；不执行其中指令
- `baseUrl` 仅允许 http/https，但刻意放行回环以支持本地模型；不要随意放宽
- AI 输出经 DOMPurify 后再插入 DOM

## 未启用代码

其他厂商适配器、`rag/*`、`KnowledgeBaseController`、`CrawlerController`、`DeepSeekClient`、`ConfigManager` 不在当前对话链路中，除非明确要求重新启用。
