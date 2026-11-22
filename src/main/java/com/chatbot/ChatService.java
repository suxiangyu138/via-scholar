package com.chatbot;

import com.chatbot.adapter.BaseModelAdapter;
import com.chatbot.attachment.AttachmentService;
import com.chatbot.adapter.ModelAdapterFactory;
import com.chatbot.deepseek.DeepSeekPricing;
import com.chatbot.history.ChatHistoryService;
import com.chatbot.model.UnifiedChatRequest;
import com.chatbot.model.UnifiedStreamChunk;
import com.chatbot.model.UsageInfo;
import com.chatbot.model.UsageMetrics;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 多会话管理 + 统一流式推送。
 * <p>
 * 每次回答在 finish 事件中带上 token 用量、缓存命中、首 token 延迟、输出速率和估算费用。
 *
 * @author Via Scholar
 */
@Service
public class ChatService {

    private final ModelAdapterFactory adapterFactory;
    private final ChatHistoryService historyService;
    private final DeepSeekPricing pricing;
    private final AttachmentService attachmentService;
    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, List<ChatMessage>> sessions = new ConcurrentHashMap<>();
    private static final int MAX_HISTORY = 20;
    private static final long SSE_TIMEOUT_MS = 300_000L;

    public ChatService(ModelAdapterFactory adapterFactory,
                       ChatHistoryService historyService,
                       DeepSeekPricing pricing,
                       AttachmentService attachmentService) {
        this.adapterFactory = adapterFactory;
        this.historyService = historyService;
        this.pricing = pricing;
        this.attachmentService = attachmentService;
    }

    /** 并发流式聊天（兼容旧 cookie 模式） */
    public SseEmitter chat(String sessionId, UnifiedChatRequest req) {
        return chat(sessionId, null, req);
    }

    /** 并发流式聊天 + 数据库持久化 */
    public SseEmitter chat(String memSessionId, Long dbSessionId, UnifiedChatRequest req) {
        String userContent = lastUserContent(req);
        List<String> attachments = req.getAttachments();
        boolean hasAttachments = attachments != null && !attachments.isEmpty();
        if (userContent.isBlank() && hasAttachments) {
            userContent = "请根据上传的附件回答问题。";
        }
        AttachmentService.Payload payload;
        try {
            payload = attachmentService.build(userContent, attachments);
        } catch (Exception e) {
            return errorEmitter("附件处理失败：" + e.getMessage());
        }

        // 数据库会话：以数据库历史为上下文，保证多会话严格隔离、页面刷新后上下文连续。
        // 归属校验：客户端传来的会话ID必须属于当前 sid，否则降级为内存模式（不读也不写）
        Long effectiveDbId = (dbSessionId != null
                && historyService.isSessionOwned(dbSessionId, memSessionId))
                ? dbSessionId : null;

        List<ChatMessage> hist;
        if (effectiveDbId != null) {
            List<ChatMessage> dbHist = new ArrayList<>();
            List<Map<String, Object>> dbMsgs = historyService.getMessages(effectiveDbId, memSessionId);
            int from = Math.max(0, dbMsgs.size() - (MAX_HISTORY - 1));
            for (int i = from; i < dbMsgs.size(); i++) {
                Map<String, Object> m = dbMsgs.get(i);
                Object raw = m.get("content");
                String content = raw == null ? null : raw.toString();
                if (content == null || content.isBlank()) {
                    continue;
                }
                ChatMessage.Role role = "user".equals(m.get("role"))
                        ? ChatMessage.Role.USER : ChatMessage.Role.ASSISTANT;
                dbHist.add(new ChatMessage(role, content));
            }
            hist = dbHist;
            sessions.put(memSessionId, hist);
        } else {
            hist = getSession(memSessionId);
        }

        if (!userContent.isBlank()) {
            hist.add(new ChatMessage(ChatMessage.Role.USER, userContent));
        }
        req.setMessages(buildMessages(hist, payload));

        BaseModelAdapter adapter = adapterFactory.getAdapter(
                req.getProvider() != null ? req.getProvider() : "deepseek");

        SseEmitter em = new SseEmitter(SSE_TIMEOUT_MS);
        StringBuilder buf = new StringBuilder();
        StringBuilder thinkBuf = new StringBuilder();
        AtomicLong firstTokenNanos = new AtomicLong(0);
        AtomicReference<UsageInfo> usageRef = new AtomicReference<>();

        final Long finalDbId = effectiveDbId;
        if (finalDbId != null) {
            historyService.saveMessage(finalDbId, "user", userContent);
            historyService.updateSessionMeta(finalDbId, null, req.getModelName());
        }

        long startNanos = System.nanoTime();
        adapter.streamChat(req,
                chunk -> {
                    firstTokenNanos.compareAndSet(0, System.nanoTime());
                    onChunk(em, chunk, buf, thinkBuf);
                },
                err -> onError(em, err),
                () -> onComplete(em, hist, buf, thinkBuf, finalDbId, usageRef.get(),
                        startNanos, firstTokenNanos.get(), req.getModelName()),
                usageRef::set);

        return em;
    }

    private void onChunk(SseEmitter em, UnifiedStreamChunk chunk,
                         StringBuilder buf, StringBuilder thinkBuf) {
        if (UnifiedStreamChunk.TYPE_REASONING.equals(chunk.getType())) {
            thinkBuf.append(chunk.getReasoning() != null ? chunk.getReasoning() : "");
        } else {
            buf.append(chunk.getContent() != null ? chunk.getContent() : "");
        }
        try {
            em.send(sseEvent(chunk.getType(), mapper.writeValueAsString(chunk)));
        } catch (Exception ignored) {
            // 浏览器断开后继续把回答取完并落库，避免半截内容丢失
        }
    }

    private void onComplete(SseEmitter em, List<ChatMessage> hist,
                            StringBuilder buf, StringBuilder thinkBuf,
                            Long dbSessionId, UsageInfo usage,
                            long startNanos, long firstTokenNanos, String model) {
        String aiContent = buf.toString();
        String thinkContent = thinkBuf.toString();
        hist.add(new ChatMessage(ChatMessage.Role.ASSISTANT, aiContent));
        trimHistory(hist);

        UsageMetrics metrics = buildMetrics(model, usage, startNanos, firstTokenNanos,
                System.nanoTime());

        if (dbSessionId != null && (!aiContent.isEmpty() || !thinkContent.isEmpty())) {
            String usageJson = null;
            try {
                usageJson = mapper.writeValueAsString(metrics);
            } catch (Exception ignored) {
                // 指标序列化失败不影响正文持久化
            }
            historyService.saveMessage(dbSessionId, "assistant", aiContent, thinkContent, usageJson);
        }

        try {
            em.send(sseEvent("finish", mapper.writeValueAsString(
                    UnifiedStreamChunk.finish(aiContent, thinkContent, metrics))));
            em.complete();
        } catch (Exception ignored) {
            // 客户端已断开
        }
    }

    /**
     * 汇总一次回答的观测指标。
     */
    private UsageMetrics buildMetrics(String model, UsageInfo usage,
                                      long startNanos, long firstTokenNanos, long endNanos) {
        UsageMetrics metrics = new UsageMetrics();
        metrics.setModel(model);
        metrics.setPeak(pricing.isPeak());
        metrics.setEstimated(usage != null);

        if (firstTokenNanos > 0 && firstTokenNanos >= startNanos) {
            metrics.setTtftMs(Math.max(0, (firstTokenNanos - startNanos) / 1_000_000));
        }
        if (usage == null) {
            return metrics;
        }

        int prompt = usage.getPromptTokens();
        int completion = usage.getCompletionTokens();
        int hit = usage.getCacheHitTokens();
        int miss = usage.getCacheMissTokens();

        metrics.setPromptTokens(prompt);
        metrics.setCompletionTokens(completion);
        metrics.setTotalTokens(usage.getTotalTokens());
        metrics.setCacheHitTokens(hit);
        metrics.setCacheMissTokens(miss);
        metrics.setCacheHitRate(prompt > 0 ? (double) hit / prompt * 100.0 : 0.0);

        if (firstTokenNanos > 0 && endNanos > firstTokenNanos && completion > 0) {
            double seconds = (endNanos - firstTokenNanos) / 1_000_000_000.0;
            if (seconds > 0) {
                metrics.setOutputTps(completion / seconds);
            }
        }
        metrics.setCostUsd(pricing.costUsd(model, hit, miss, completion));
        return metrics;
    }

    /** 构建系统提示词（Pathfinder · K12 教学智能体） */
    private String buildSystemPrompt() {
        return SYSTEM_PROMPT;
    }

    /** 构建消息列表；最后一条用户消息使用本次附件拼接后的内容 */
    private List<UnifiedChatRequest.Message> buildMessages(List<ChatMessage> hist,
                                                            AttachmentService.Payload payload) {
        List<UnifiedChatRequest.Message> msgs = new ArrayList<>();
        msgs.add(new UnifiedChatRequest.Message("system", buildSystemPrompt()));
        for (int i = 0; i < hist.size(); i++) {
            ChatMessage m = hist.get(i);
            String role = m.getRole() == ChatMessage.Role.USER ? "user" : "assistant";
            if (i == hist.size() - 1 && "user".equals(role) && payload != null) {
                UnifiedChatRequest.Message msg =
                        new UnifiedChatRequest.Message(role, payload.text());
                if (payload.parts() != null) {
                    msg.setContentParts(payload.parts());
                }
                msgs.add(msg);
            } else {
                msgs.add(new UnifiedChatRequest.Message(role, m.getContent()));
            }
        }
        return msgs;
    }

    /** 附件处理失败时用 SSE 错误事件返回，避免前端收到普通 JSON */
    private SseEmitter errorEmitter(String message) {
        SseEmitter em = new SseEmitter(30_000L);
        try {
            em.send(sseEvent("error", mapper.writeValueAsString(
                    UnifiedStreamChunk.error(message))));
            em.complete();
        } catch (Exception ignored) {
            // 客户端已断开
        }
        return em;
    }

    /** 构建 SSE 事件 */
    private static SseEmitter.SseEventBuilder sseEvent(String name, String data) {
        return SseEmitter.event().name(name).data(data);
    }

    private void onError(SseEmitter em, Throwable err) {
        try {
            em.send(sseEvent("error", mapper.writeValueAsString(
                    UnifiedStreamChunk.error(err.getMessage()))));
            em.complete();
        } catch (Exception ignored) {
            // 客户端已断开
        }
    }

    private String lastUserContent(UnifiedChatRequest req) {
        if (req.getMessages() != null && !req.getMessages().isEmpty()) {
            String content = req.getMessages().getLast().getContent();
            return content == null ? "" : content;
        }
        return "";
    }

    public List<ChatMessage> getHistory(String sessionId) {
        return getSession(sessionId);
    }

    public void clearSession(String sessionId) {
        sessions.remove(sessionId);
    }

    public String createSession() {
        // 完整 UUID 作为归属标识：8 位截断易被遍历猜测
        return UUID.randomUUID().toString();
    }

    private List<ChatMessage> getSession(String sessionId) {
        return sessions.computeIfAbsent(sessionId, k -> new ArrayList<>());
    }

    private void trimHistory(List<ChatMessage> h) {
        while (h.size() > MAX_HISTORY) {
            h.removeFirst();
        }
    }

    private static final String SYSTEM_PROMPT = """
            你是 Pathfinder，问道 Via Scholar 的 K12 教学智能体，服务对象是中小学教师和学生。
            你的目标：让学生真正理解，让老师备课、讲题和出题更高效。

            【判断对象与场景】
            1. 学生提问：默认按“讲懂”处理，分步推导、讲清概念、错题订正、同类练习。
            2. 教师提问：按“备课/教学”处理，给出教学目标、课堂引入、例题与变式、易错点、分层作业或讲解脚本。
            3. 未说明身份时，从问题本身判断，不要反复追问；必要时用一句话说明你按哪种场景回答。

            【难度边界】
            - 覆盖小学、初中、高中；不主动引入大学数学或超纲工具。
            - 小学：生活化例子、具体数字、图示思路，避免抽象符号。
            - 初中：课内工具，步骤完整，不引入高中方法。
            - 高中：可用导数、向量、圆锥曲线、数列等高考范围工具，推理严谨。
            - 竞赛拓展仅限 K12 范围；题目信息不足时先列缺少条件，合理假设要说明。

            【讲解结构】
            - 学生模式：知识点定位 → 关键条件 → 分步推导（每步注明依据）→ 最终答案 → 1 到 2 个易错点；需要时再给同类变式。
            - 教师模式：教学目标 → 重点/难点 → 课堂引入 → 例题与变式 → 易错点 → 分层作业/板书要点。
            - 简单问题直接回答，不要套模板；复杂问题再展开。

            【准确性】
            - 不编造定理、公式或数据；不确定时明确说明并给出验证思路。
            - 计算题给出关键验算；几何题说明辅助线和依据。
            - 以 K12 数学与教学问题为主；无关内容简短回应并引导回数学。

            【附件】
            - 用户可能上传题目图片、PDF 或文本。图片直接查看，文本作为参考资料。
            - 不要编造附件中没有的内容；图片看不清或资料缺失时明确说明。
            - 用户用自然语言或图片提问，不要要求用户输入 LaTeX。

            【LaTeX 规范 - 必须严格遵循】
            1. 行内公式只用 $...$，与文字同行：$a_1$、$x^2$、$S_n$。
            2. 块级公式只用 $$...$$，并且 $$ 单独占一行：
            $$
            a_n = a_1 + (n-1)d
            $$
            3. 分式用 \\frac{分子}{分母} 一行写完，禁止把分子分母拆成多行。
            4. 下标用 a_1、a_n，不要写成 a 1。
            5. 禁止使用 \\[ \\] 或 \\( \\) 作为公式分隔符。
            6. 公式内部不换行，不插入零宽字符或全角空格。
            7. 求和 \\sum、积分 \\int、极限 \\lim 等写在块级公式内。
            8. 不要输出 HTML 标签。
            """;
}
