# CLAUDE.md

技术说明，供后续开发参考。

## 产品

**问道 Via Scholar** 是面向 K12 教师与学生的教学智能体，Agent 名 **Pathfinder**，模型只用 **DeepSeek**。

- 学生：分步解题、概念讲解、错题订正、同类练习
- 教师：教学目标、课堂引入、例题与变式、易错点、分层作业
- 学段：小学、初中、高中；不主动引入大学数学
- RAG 已从产品下线，`com.chatbot.rag` 代码保留但不参与对话

## 构建与运行

Java 25 / Maven 3.9+：

```bash
mvn -DskipTests package
java -jar target/via-scholar-4.0.0.jar

# 或
mvn spring-boot:run
```

默认监听 `127.0.0.1:8080`，无自动化测试。

## 请求流

```text
POST /api/attachments (multipart, 最多 50 个)
  → AttachmentService 落盘 data/uploads，返回附件 ID

POST /api/chat { messages, attachments:[id] }
  → ChatController
  → ChatService（读取历史、拼接 SYSTEM_PROMPT、计时、落库）
      附件：PDF/文本 → 拼入用户文本；图片 → data URL content parts
  → DeepSeekAdapter.streamChat
      stream_options.include_usage = true
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
| `POST /api/chat` | 流式对话 |

`DeepSeekApiClient.apiRoot()` 会去掉末尾 `/`、`/v1` 或 `/chat/completions`，再拼接 `/models`、`/user/balance`；对话仍使用用户填写的 baseUrl + `/chat/completions`。

## 费用

`DeepSeekPricing` 按官方美元价（每百万 token）估算：

- `deepseek-flash`：命中 0.006/0.003，未命中 0.30/0.15，输出 1.20/0.60
- `deepseek-v4-pro`：命中 0.044/0.022，未命中 1.32/0.66，输出 3.96/1.98

斜线前为高峰价、后为低峰价。高峰为 UTC 周一至周五 `01:00-04:00`、`06:00-10:00`；未接入法定节假日，前端标注为估算。未知模型 `costUsd` 为 null。

## 前端

- `static/index.html`：结构
- `static/assets/app.css`：白底极简样式；1024px 以下侧边栏变抽屉，760px 以下收紧顶栏
- `static/assets/app.js`：配置、余额、模型弹层、附件上传、SSE、Markdown/KaTeX、指标、历史、错题本
- 外部 CDN：KaTeX、highlight.js、marked；DOMPurify 本地
- `localStorage`：`deepseekConfigV2`、`currentDbSessionId`、`mathErrorBook`
- 旧配置会从 `modelConfigs.deepseek` 迁移，旧模型名映射到 `deepseek-flash` / `deepseek-v4-pro`

## 会话与数据

- `sid` 由 `POST /api/history/session/create` 写入 1 年 HttpOnly Cookie
- `chat_session.owner_sid` 做归属校验；`chat_message` 保存正文、思考过程和 `usage_json`
- H2：`./data/chatbot-db.mv.db`；`ddl-auto=update`
- 无 DB 会话时回退到 `ChatService.sessions`；同一会话不要并发写入

## 安全边界

- 只监听本机；CORS 只允许 localhost
- `/api/chat` 30 次/分钟/IP；其他 `/api` 300 次/分钟
- `baseUrl` 仅允许 http/https，但刻意放行回环以支持本地模型；不要随意放宽
- AI 输出经 DOMPurify 后再插入 DOM

## 未启用代码

其他厂商适配器、`rag/*`、`KnowledgeBaseController`、`CrawlerController`、`DeepSeekClient`、`ConfigManager` 不在当前对话链路中，除非明确要求重新启用。
