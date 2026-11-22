# 问道 Via Scholar

面向 K12 教师与学生的全学科 AI 教学智能体。

学生用它分步理解题目，教师用它备课、出题和整理易错点。对话由 **Pathfinder** 完成，模型统一使用 **DeepSeek**。

- GitHub：https://github.com/suxiangyu138/via-scholar
- Gitee：https://gitee.com/suxiangyu138/via-scholar
- 当前版本：v4.0.0
- 技术栈：Java 25 · Spring Boot 3.5 · H2 · 原生 JS

## 功能

- **双模式教学**：学生模式下分步讲懂；教师模式下生成教学目标、例题、易错点和分层作业
- **K12 全学科**：语文、数学、英语、物理、化学、生物、历史、地理、道德与法治/思想政治、科学、信息科技等；覆盖小学、初中、高中，不因学科拒答
- **题目附件**：点击「附件」选择相机、相册或文件管理；支持图片、PDF、txt/md/csv/json/html/tex，单条消息最多 50 个
- **DeepSeek 单厂商**：模型列表从上游实时获取，不再聚合多厂商
- **账户余额**：顶部显示 DeepSeek 账户余额，点击可刷新
- **用量指标**：输入/输出 token、缓存命中率、首 token 延迟、输出速率、人民币估算费用
- **流式回答**：SSE 增量推送，推理过程与正式答案分层展示
- **学科渲染**：数学/物理公式用 KaTeX，化学式与方程式用 mhchem，代码块自动高亮，表格与 Markdown 稳定排版
- **对话历史**：H2 持久化，按会话隔离；支持编辑模式、多选、全选和批量删除
- **我的收藏**：回答下方一键收藏，侧边栏查看、复制和删除；收藏保存在本机浏览器
- **个性化设置**：可填写个性提示词，影响表达方式、深度和例子，不覆盖准确性与安全规则
- **清晰排版**：每次回答带概括性标题，段落、列表和公式留白，适合长内容阅读
- **回答风格**：严肃克制、正式得体，不训斥、不反问、不使用 emoji
- **阅读字号**：设置中可调 12–22 px，默认 14 px，只影响回答正文，保存在本机
- **回答导出**：每条回答可导出 TXT、Word（原生 .docx）或 PDF；文件名使用回答标题＋年月日时分秒毫秒，避免重名
- **稳定滚动**：流式生成时用户上翻阅读不会被强制拉回底部，新内容有提示，回到底部后可继续跟随
- **重新编辑 / 重新生成**：用户问题可改后重发，AI 回答可重新生成；网络异常时错误框内可直接重试
- **深度思考**：默认关闭，开启后使用 DeepSeek `reasoning_effort: max`；**联网搜索**默认开启，使用 DeepSeek Search，结果注入系统提示词
- **结构化渲染**：回答首行带学科/内容类型元数据，Markdown、KaTeX、mhchem、代码高亮和表格统一渲染
- **移动端适配**：模型底部弹层、侧边栏抽屉、输入框安全区适配

## 快速开始

环境要求：JDK 25+、Maven 3.9+。

```bash
git clone https://github.com/suxiangyu138/via-scholar.git
cd via-scholar
mvn spring-boot:run
```

访问 http://localhost:8080。

也可以先打包再运行：

```bash
mvn -DskipTests package
java -jar target/via-scholar-4.0.0.jar
```

### 配置

1. 点击顶部模型胶囊，或侧边栏底部的当前模型卡片
2. 填写 DeepSeek API Key
3. 点击「获取最新模型」，从上游列表中选择模型
4. 保存后，顶部显示账户余额，即可开始对话

API Key 仅保存在当前浏览器的 `localStorage`，每次请求由本机服务转发给 DeepSeek，不写入服务端配置文件。个性化提示词和收藏同样只保存在本机浏览器。

## 指标与费用

每次回答结束，服务端在 SSE 的 `finish` 事件中返回指标：

| 字段 | 说明 |
|------|------|
| `promptTokens` / `completionTokens` | 输入 / 输出 token |
| `cacheHitRate` | `prompt_cache_hit_tokens / prompt_tokens` |
| `ttftMs` | 从发起上游请求到第一个内容分片的时间 |
| `outputTps` | 输出 token / 首 token 之后的耗时 |
| `costUsd` | 按 DeepSeek 官方价格估算的美元费用；界面折算为人民币 |

- 服务端以美元计价；界面按 1 美元 ≈ 7.1 元折算为人民币，前缀 `≈` 表示估算，实际以账单为准
- 高峰时段为 UTC 周一至周五 `01:00-04:00`、`06:00-10:00`，其余时段按低峰价
- 未接入中国法定节假日表
- 余额来自 DeepSeek `/user/balance`，按接口返回的 CNY / USD 显示
- 指标随回答写入 H2，切换历史会话后仍可回看

## 渲染与阅读

- 回答首行输出 `<!--via-meta {"subject":"数学","type":"formula","grade":"高中"}-->`，前端解析后显示学科/类型标签，不把元数据当正文
- Markdown 由 marked 解析；公式由 KaTeX auto-render 渲染；化学式/方程式由 mhchem 渲染；代码块由 highlight.js 高亮，未标注语言时自动识别
- 流式输出中未闭合的 `$`、`$$`、`\(`、`\[` 或代码围栏先按纯文本显示，闭合后再渲染，避免半截公式和代码块闪烁
- 字号设置范围 12–22 px，默认 14 px；标题、代码、表格和公式随正文字号同步缩放

## 覆盖学科

- 小学：语文、数学、英语、道德与法治、科学、体育与健康、音乐、美术、信息科技、劳动，以及书法、心理健康、综合实践
- 初中：语文、数学、英语、道德与法治、历史、地理、生物、物理、化学、体育与健康、音乐、美术、信息科技、劳动
- 高中：语文、数学、英语，物理/历史二选一，思想政治/地理/化学/生物四选二，以及体育、音乐、美术、信息技术、通用技术、心理健康、综合实践
- 拓展：编程、机器人、科学实验、英语口语、写作、奥数

## 架构

```text
Browser (index.html + assets/app.js)
  → POST /api/chat
  → ChatController
  → ChatService（Pathfinder 提示词 / 上下文 / 指标）
  → DeepSeekAdapter
  → DeepSeek /chat/completions
  ← SSE: chunk / reasoning / finish / error
```

- 前端：`index.html` + `assets/app.css` + `assets/app.js`，原生 JS，无构建步骤
- 业务：`ChatService` 负责提示词、会话和指标；`DeepSeekPricing` 负责费用估算
- 附件：`AttachmentService` 落盘临时文件，提取 PDF/文本，并将图片转为 data URL 内容片段
- 适配：`BaseModelAdapter` 逐行解析 SSE，`DeepSeekAdapter` 请求 `include_usage`
- 数据：H2 文件库；会话按 `sid` 归属隔离
- 本机数据：收藏与个性提示词存 `localStorage`，不写入服务端

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | SSE 流式对话；可传 `customInstructions`、`deepThinking`、`webSearch` |
| GET | `/api/history/sessions` | 历史会话列表 |
| POST | `/api/history/session/create` | 新建会话 |
| GET | `/api/history/messages/{id}` | 会话消息，含思考过程与指标 |
| DELETE | `/api/history/session/{id}` | 删除单条会话 |
| POST | `/api/history/sessions/delete` | 批量删除会话，body `{"ids":[1,2]}` |
| POST | `/api/history/messages/truncate` | 从指定消息起截断，body `{"sessionId":1,"fromMessageId":2}` |
| POST | `/api/attachments` | 上传图片/文件，最多 50 个 |
| DELETE | `/api/attachments/{id}` | 删除未发送的附件 |
| POST | `/api/deepseek/models` | 获取上游最新模型 |
| POST | `/api/deepseek/balance` | 获取账户余额 |

## 目录

```text
src/main/java/com/chatbot/
├── ChatController.java / ChatService.java
├── adapter/            # BaseModelAdapter / DeepSeekAdapter
├── attachment/         # 附件上传、PDF/文本解析、图片内容片段
├── deepseek/           # 模型、余额、价格估算
├── history/            # H2 会话与消息
├── model/              # 请求、SSE、用量指标
└── rag/                # 知识库代码保留，当前未接入

src/main/resources/static/
├── index.html
├── assets/app.css
├── assets/app.js
└── dompurify.min.js
```

运行时数据写入项目目录下的 `data/`（已 gitignore）：`data/chatbot-db.mv.db`、`data/config/`。

## 说明

- 仅接入 DeepSeek；其他厂商适配器保留但未暴露
- 图片输入仅 `deepseek-flash` 支持；`deepseek-v4-pro` 为纯文本，前端会提示切换
- 附件单文件上限 20MB、总量 100MB、图片总量 25MB；PDF 只提取文本，扫描版建议上传题目图片
- 附件内容只随当轮发送拼入上下文；历史消息保存文字，不保存原文件
- RAG 已从产品入口下线，`com.chatbot.rag` 代码保留，后续如需启用应单独设计检索评测
- 默认只监听 `127.0.0.1`；如改为 `0.0.0.0`，需要先加认证与 HTTPS
- 项目暂未配置自动化测试

## 许可与反馈

MIT License，详见 [LICENSE](./LICENSE)。

维护者：suxiangyu138

问题反馈：请提交 [Issue](https://github.com/suxiangyu138/via-scholar/issues)，或直接反馈给维护者。
