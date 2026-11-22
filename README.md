# 问道 Via Scholar

面向 K12 教师与学生的全学科 AI 教学智能体。

学生用它分步理解题目，教师用它备课、出题和整理易错点。对话由 **Pathfinder** 完成，模型统一使用 **DeepSeek**。

- GitHub：https://github.com/suxiangyu138/via-scholar
- Gitee：https://gitee.com/suxiangyu138/via-scholar
- 当前版本：v4.1.0（阶段性开发）
- 技术栈：Java 25 · Spring Boot 3.5.15 · H2 · 原生 JS

## 功能

### 教学与对话

- **K12 全学科**：覆盖小学、初中、高中语文、数学、英语、物理、化学、生物、历史、地理、道德与法治/思想政治、科学、信息科技、通用技术及素质课程，不因学科拒答
- **教学上下文**：顶部可选择学段、学科、身份和教材版本，随请求注入提示词，回答按课堂调整
- **学生 / 教师双场景**：学生模式分步讲懂、错题订正、同类练习；教师模式生成教学目标、课堂引入、例题变式、易错点和分层作业
- **回答规范**：提示词要求每次回答带概括标题，语气严肃克制、不训斥、不反问、不使用 emoji
- **深度思考**：默认关闭；开启后请求 DeepSeek `thinking: enabled` 和 `reasoning_effort: high`；当前 DeepSeek Flash 的输出预算按 8192 处理，若推理仍耗尽预算，服务端自动用标准模式补全正文；推理区默认不渲染，展开时才渲染，且只显示前 9000 字
- **联网搜索**：默认开启，调用 DeepSeek Search；搜索结果注入系统提示词并附来源链接，搜索失败不阻断对话
- **流式回答**：SSE 增量推送，推理过程与正文分层展示

### 交互与导出

- **稳定滚动**：用户上翻阅读时停止自动跟随，生成继续；新内容有提示，回到底部恢复跟随
- **重新编辑 / 重新生成**：问题可修改后重发，回答可重新生成；网络异常时错误框内可直接重试
- **对话管理**：侧边栏可搜索历史，进入编辑模式后可多选、全选、批量删除；支持单条删除和重命名
- **我的收藏**：回答下方一键收藏，侧边栏查看、复制、删除；收藏保存在浏览器
- **回答导出**：每条回答可导出 TXT、原生 DOCX 或 PDF；TXT/Word 保留公式源码，PDF 保留公式、代码、表格视觉排版；文件名为回答标题＋`YYYYMMDD_HHmmss_SSS`
- **个性化设置**：个性提示词、回答字号 12–22 px（默认 14 px），保存在浏览器
- **移动端适配**：模型底部弹层、侧边栏抽屉、附件来源弹层、输入框安全区适配

### 数据与渲染

- **对话历史**：H2 持久化，按 `sid` 归属隔离；消息带 `msgId`，支持从指定消息截断
- **附件**：图片、PDF、文本文件；单条最多 50 个
- **全学科渲染**：Markdown、KaTeX 数学/物理公式、mhchem 化学式与方程式、highlight.js 代码高亮、Markdown 表格；公式逐个渲染，单个坏公式不影响整篇
- **教学组件**：代码卡、宽表格横向滚动和参考来源；数学/物理/化学公式直接排版，不套卡片；易错点、考点、结论使用普通加粗段落，不使用引用块和底色卡片
- **教学动作**：回答下方可一键生成板书提纲、同类题和分层作业
- **教学起始页**：首页提供讲一道题、备一节课、出一组题、自由提问四个入口；选中后显示模式横幅，可取消，也可再次点击退出；首页固定高度不上下滚动，手机端使用紧凑标题和特性卡；玻璃卡片、星空粒子、星座连线、微光背景和轻微动效只做视觉层
- **身份结构**：学生回答按结论/分步讲解/易错点组织，教师回答按教学目标/重难点/课堂流程/板书/分层作业组织
- **流式闭合缓冲**：未闭合的公式先显示“公式生成中”占位，代码围栏按纯文本显示，闭合后再渲染
- **结构化元数据**：回答首行支持 `<!--via-meta {...}-->`，前端解析学科/类型标签并隐藏注释
- **本页目录**：桌面端右侧吸附，移动端底部弹层；按回答中的章节标题生成

## 快速开始

环境要求：JDK 25+、Maven 3.9+。

```bash
git clone https://github.com/suxiangyu138/via-scholar.git
cd via-scholar
mvn spring-boot:run
```

访问 http://localhost:8080。

也可以打包运行：

```bash
mvn -DskipTests package
java -jar target/via-scholar-4.1.0.jar
```

### 配置

1. 点击顶部模型胶囊，或侧边栏底部的当前模型卡片
2. 填写 DeepSeek API Key
3. 点击「获取最新模型」，从上游列表中选择模型
4. 保存后顶部显示账户余额，即可开始对话

API Key 只保存在当前浏览器的 `localStorage`，每次请求由本机服务转发给 DeepSeek，不写入服务端配置文件。个性提示词、字号、深度思考/联网搜索开关和收藏也只保存在本机浏览器。

## 指标与费用

每次回答结束，服务端在 SSE 的 `finish` 事件中返回指标：

| 字段 | 说明 |
|------|------|
| `promptTokens` / `completionTokens` | 输入 / 输出 token |
| `cacheHitRate` | `prompt_cache_hit_tokens / prompt_tokens` |
| `ttftMs` | 从发起上游请求到第一个内容分片的时间 |
| `outputTps` | 输出 token / 首 token 之后的耗时 |
| `costUsd` | 按 DeepSeek 官方价格估算的美元费用 |
| `peak` | 是否处于高峰计价时段 |
| `estimated` | 是否为估算值 |

- 服务端按美元价格计算，前端按 1 USD ≈ 7.1 CNY 折算为人民币，并用 `≈` 标识估算，实际以账单为准
- 高峰时段为 UTC 周一至周五 `01:00-04:00`、`06:00-10:00`，其余时段按低峰价；未接入中国法定节假日表
- 余额来自 DeepSeek `/user/balance`，按接口返回的 CNY / USD 显示
- 指标随回答写入 H2，切换历史会话后仍可回看
- 联网搜索由 DeepSeek Search 单独计费，不计入上述 token 费用；可在输入框上方随时关闭

## 渲染与阅读

- 回答首行支持 `<!--via-meta {"subject":"数学","type":"formula","grade":"高中"}-->`，前端解析后显示学科/类型标签，不把元数据当正文；模型未输出时自动回退
- Markdown 由 marked 解析，公式由 KaTeX auto-render 渲染，化学式/方程式由 mhchem 渲染，代码块由 highlight.js 高亮，未标语言时自动识别
- 中文标点后的 `**加粗**`、`\[...\]` 公式、代码块内的 `**` 和 `$` 均做了兼容处理
- 流式输出中未闭合的公式先显示“公式生成中”占位，代码围栏按纯文本占位，闭合后再渲染
- 最终渲染会自动补齐漏掉的 `$`/`$$` 和常见 LaTeX 括号，避免把公式源码直接暴露在正文中
- 最终渲染后只把代码块包成教学卡；公式和化学式直接排版，避免卡片边框和留白遮挡数字；宽表格使用 `max-content` 横向滚动并显示滑动提示；引用链接汇总为“参考链接”
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
  → ChatService（历史 / 教学上下文 / 提示词 / 可选 DeepSeek Search / 指标）
  → DeepSeekAdapter
  → DeepSeek /chat/completions（thinking / reasoning_effort）
  ← SSE: reasoning / chunk / finish / error
```

- 前端：`index.html` + `assets/app.css` + `assets/app.js`，原生 JS，无构建步骤
- 业务：`ChatService` 负责提示词、会话、搜索上下文和指标；`DeepSeekPricing` 负责费用估算
- 附件：`AttachmentService` 落盘临时文件，提取 PDF/文本，图片转为 data URL 内容片段
- 搜索：`DeepSeekApiClient` 调用 DeepSeek `/v1/tools/search`，结果作为外部资料注入系统提示词
- 适配：`BaseModelAdapter` 逐行解析 SSE；`DeepSeekAdapter` 请求 `include_usage`、thinking 配置
- 数据：H2 文件库；会话按 `sid` 归属隔离；无 DB 会话时回退到内存
- 本机数据：收藏、个性提示词、字号和开关存 `localStorage`

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | SSE 流式对话；支持 `customInstructions`、`deepThinking`、`webSearch`、`stage`、`subject`、`role`、`textbook` |
| GET | `/api/history` | 当前内存会话历史 |
| DELETE | `/api/chat` | 清空当前内存会话 |
| GET | `/api/session` | 生成新的内存会话 ID |
| POST | `/api/history/session/create` | 新建数据库会话，写入 `sid` Cookie |
| GET | `/api/history/sessions` | 历史会话列表 |
| GET | `/api/history/messages/{id}` | 会话消息，含思考过程、指标和 `msgId` |
| DELETE | `/api/history/session/{id}` | 逻辑删除单条会话 |
| PUT | `/api/history/session/rename` | 重命名会话 |
| POST | `/api/history/sessions/delete` | 批量删除会话，body `{"ids":[1,2]}` |
| POST | `/api/history/messages/truncate` | 从指定消息起截断，body `{"sessionId":1,"fromMessageId":2}` |
| GET | `/api/providers` | 当前暴露的厂商和模型 |
| POST | `/api/attachments` | 上传图片/文件，最多 50 个 |
| DELETE | `/api/attachments/{id}` | 删除未发送附件 |
| POST | `/api/deepseek/models` | 代理 `GET {root}/models` |
| POST | `/api/deepseek/balance` | 代理 `GET {root}/user/balance` |

## 目录

```text
src/main/java/com/chatbot/
├── ChatController.java / ChatService.java
├── ConfigController.java / ConfigManager.java
├── adapter/            # BaseModelAdapter / DeepSeekAdapter
├── attachment/         # 附件上传、PDF/文本解析、图片内容片段
├── deepseek/           # 模型、余额、Search、价格估算
├── history/            # H2 会话与消息
├── model/              # 请求、SSE、用量指标
└── rag/                # 知识库代码保留，当前未接入

src/main/resources/static/
├── index.html
├── manifest.json
├── favicon.ico
├── dompurify.min.js
└── assets/
    ├── app.css
    ├── app.js
    └── brand-*.png
```

运行时数据写入项目目录下的 `data/`（已 gitignore）：`data/chatbot-db.mv.db`、`data/uploads/`、`data/config/`、`data/lucene_index/`。

## 说明

- 仅接入 DeepSeek；其他厂商适配器保留但未暴露
- 图片输入仅 `deepseek-flash` 支持；`deepseek-v4-pro` 为纯文本，前端会提示切换
- 附件支持 png/jpg/jpeg/webp/gif、PDF、txt/md/markdown/csv/json/html/htm/tex/log；单文件 20MB、总量 100MB、图片总量 25MB；PDF 只提取文本，扫描版建议上传题目图片
- 附件内容只随当轮发送拼入上下文；历史消息保存文字，不保存原文件；启动时清理超过 24 小时的上传文件
- 重新编辑/重新生成会截断目标用户消息及其后的消息，再重新发送；原附件不会恢复
- RAG 已从产品入口下线，`com.chatbot.rag` 代码保留，后续如需启用应单独设计检索评测
- 当前未接入 ECharts 图表和听力音频播放器
- 默认只监听 `127.0.0.1`；如改为 `0.0.0.0`，需要先加认证与 HTTPS
- 项目暂未配置自动化测试

## 许可与反馈

MIT License，详见 [LICENSE](./LICENSE)。

作者：苏巷雨（suxiangyu138）

邮箱：suxiangyu_dev@foxmail.com

仓库：[GitHub](https://github.com/suxiangyu138/via-scholar) · [Gitee](https://gitee.com/suxiangyu138/via-scholar)

问题反馈：请提交 [Issue](https://github.com/suxiangyu138/via-scholar/issues)，或发送邮件。反馈时请附上复现步骤、设备与浏览器信息、相关截图，不要发送 API Key 等敏感信息。
