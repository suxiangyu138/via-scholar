package com.chatbot.model;

/**
 * 一次回答的完整观测指标：token 用量、缓存命中、首 token 延迟、输出速率与估算费用。
 * <p>
 * 费用以美元计价（DeepSeek 官方价格页以 USD 标注），由服务端按当前时段费率估算。
 *
 * @author Via Scholar
 */
public class UsageMetrics {

    private String model;
    private int promptTokens;
    private int completionTokens;
    private int totalTokens;
    private int cacheHitTokens;
    private int cacheMissTokens;
    /** 缓存命中率，0-100 */
    private double cacheHitRate;
    /** 首 token 延迟（毫秒） */
    private long ttftMs;
    /** 首 token 之后的输出速率（tokens/s） */
    private double outputTps;
    /** 估算费用（美元），未知模型为 null */
    private Double costUsd;
    /** 是否处于官方高峰计费时段 */
    private boolean peak;
    /** 是否按官方费率估算 */
    private boolean estimated;

    public String getModel() { return model; }
    public void setModel(String v) { model = v; }

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

    public double getCacheHitRate() { return cacheHitRate; }
    public void setCacheHitRate(double v) { cacheHitRate = v; }

    public long getTtftMs() { return ttftMs; }
    public void setTtftMs(long v) { ttftMs = v; }

    public double getOutputTps() { return outputTps; }
    public void setOutputTps(double v) { outputTps = v; }

    public Double getCostUsd() { return costUsd; }
    public void setCostUsd(Double v) { costUsd = v; }

    public boolean isPeak() { return peak; }
    public void setPeak(boolean v) { peak = v; }

    public boolean isEstimated() { return estimated; }
    public void setEstimated(boolean v) { estimated = v; }
}
