# 问道 Via Scholar

面向 K12 教师与学生的 AI 教学智能体。

学生用它分步理解题目，教师用它备课、出题和整理易错点。对话由 **Pathfinder** 完成，模型统一使用 **DeepSeek**。

- GitHub：https://github.com/suxiangyu138/via-scholar
- Gitee：https://gitee.com/suxiangyu138/via-scholar
- 当前版本：v4.0.0
- 技术栈：Java 25 · Spring Boot 3.5 · H2 · 原生 JS

## 功能

- **双模式教学**：学生模式下分步讲懂；教师模式下生成教学目标、例题、易错点和分层作业
- **K12 难度边界**：覆盖小学、初中、高中，不主动引入大学数学或超纲工具
- **题目附件**：支持图片、PDF、txt/md/csv/json/html/tex，单条消息最多 50 个
- **DeepSeek 单厂商**：模型列表从上游实时获取，不再聚合多厂商
- **账户余额**：顶部显示 DeepSeek 账户余额，点击可刷新
- **用量指标**：输入/输出 token、缓存命中率、首 token 延迟、输出速率、估算费用
- **流式回答**：SSE 增量推送，推理过程与正式答案分层展示
- **公式渲染**：AI 输出自动渲染 LaTeX，用户只需用自然语言或图片提问
- **对话历史**：H2 持久化，按会话隔离，指标随消息保存
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

API Key 仅保存在当前浏览器的 `localStorage`，每次请求由本机服务转发给 DeepSeek，不写入服务端配置文件。

## 指标与费用

每次回答结束，服务端在 SSE 的 `finish` 事件中返回指标：

| 字段 | 说明 |
|------|------|
| `promptTokens` / `completionTokens` | 输入 / 输出 token |
| `cacheHitRate` | `prompt_cache_hit_tokens / prompt_tokens` |
| `ttftMs` | 从发起上游请求到第一个内容分片的时间 |
| `outputTps` | 输出 token / 首 token 之后的耗时 |
| `costUsd` | 按 DeepSeek 官方价格估算的费用 |

- 费用以美元计价，高峰时段为 UTC 周一至周五 `01:00-04:00`、`06:00-10:00`，其余时段按低峰价
- 未接入中国法定节假日表，费用标注为估算值
- 余额来自 DeepSeek `/user/balance`，按接口返回的 CNY / USD 显示
- 指标随回答写入 H2，切换历史会话后仍可回看

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

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | SSE 流式对话 |
| GET | `/api/history/sessions` | 历史会话列表 |
| POST | `/api/history/session/create` | 新建会话 |
| GET | `/api/history/messages/{id}` | 会话消息，含思考过程与指标 |
| DELETE | `/api/history/session/{id}` | 删除会话 |
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
