package com.chatbot.model;

/**
 * 上游返回的 token 用量（DeepSeek 在流式响应的最后一个 chunk 携带）。
 *
 * @author Via Scholar
 */
public class UsageInfo {

    private int promptTokens;
    private int completionTokens;
    private int totalTokens;
    private int cacheHitTokens;
    private int cacheMissTokens;

    public int getPromptTokens() { return promptTokens; }
    public void setPromptTokens(int v) { promptTokens = v; }

    public int getCompletionTokens() { return completionTokens; }
    public void setCompletionTokens(int v) { completionTokens = v; }

    public int getTotalTokens() { return totalTokens; }
    public void setTotalTokens(int v) { totalTokens = v; }

    public int getCacheHitTokens() { return cacheHitTokens; }
    public void setCacheHitTokens(int v) { cacheHitTokens = v; }

    public int getCacheMissTokens() { return cacheMissTokens; }
    public void setCacheMissTokens(int v) { cacheMissTokens = v; }
}
