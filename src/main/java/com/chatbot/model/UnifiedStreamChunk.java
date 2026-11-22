package com.chatbot.model;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 后端 → 前端 统一 SSE 流式数据。
 * <p>
 * 空字段不参与序列化，避免每个 chunk 重复携带累计全文。
 *
 * @author Via Scholar
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class UnifiedStreamChunk {

    public static final String TYPE_CHUNK = "chunk";
    public static final String TYPE_REASONING = "reasoning";
    public static final String TYPE_FINISH = "finish";
    public static final String TYPE_ERROR = "error";

    /** chunk=文本片段 / reasoning=思考过程 / finish=结束 / error=异常 */
    private String type;
    /** 本次流式返回文本片段 */
    private String content;
    /** 思考/推理过程文本片段 */
    private String reasoning;
    /** 完整回答（仅 finish） */
    private String fullContent;
    /** 完整思考过程（仅 finish） */
    private String fullReasoning;
    /** 一次回答的观测指标（仅 finish） */
    private UsageMetrics metrics;
    /** type=error 时的报错信息 */
    private String errMsg;

    public UnifiedStreamChunk() {}

    public UnifiedStreamChunk(String type, String content, String fullContent) {
        this.type = type;
        this.content = content;
        this.fullContent = fullContent;
    }

    public static UnifiedStreamChunk chunk(String content) {
        return new UnifiedStreamChunk(TYPE_CHUNK, content, null);
    }

    public static UnifiedStreamChunk reasoning(String reasoning) {
        UnifiedStreamChunk c = new UnifiedStreamChunk();
        c.type = TYPE_REASONING;
        c.reasoning = reasoning;
        return c;
    }

    public static UnifiedStreamChunk finish(String full, String fullReasoning,
                                            UsageMetrics metrics) {
        UnifiedStreamChunk c = new UnifiedStreamChunk();
        c.type = TYPE_FINISH;
        c.fullContent = full;
        c.fullReasoning = fullReasoning;
        c.metrics = metrics;
        return c;
    }

    public static UnifiedStreamChunk error(String msg) {
        UnifiedStreamChunk c = new UnifiedStreamChunk();
        c.type = TYPE_ERROR;
        c.errMsg = msg;
        return c;
    }

    public String getType() { return type; }
    public void setType(String v) { type = v; }

    public String getContent() { return content; }
    public void setContent(String v) { content = v; }

    public String getReasoning() { return reasoning; }
    public void setReasoning(String v) { reasoning = v; }

    public String getFullContent() { return fullContent; }
    public void setFullContent(String v) { fullContent = v; }

    public String getFullReasoning() { return fullReasoning; }
    public void setFullReasoning(String v) { fullReasoning = v; }

    public UsageMetrics getMetrics() { return metrics; }
    public void setMetrics(UsageMetrics v) { metrics = v; }

    public String getErrMsg() { return errMsg; }
    public void setErrMsg(String v) { errMsg = v; }
}
