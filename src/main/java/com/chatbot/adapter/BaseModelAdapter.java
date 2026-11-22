package com.chatbot.adapter;

import com.chatbot.model.UnifiedChatRequest;
import com.chatbot.model.UnifiedStreamChunk;
import com.chatbot.model.UsageInfo;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * 模型适配器抽象基类 — 子类只需定义厂商特定的请求体转换与端点。
 * <p>
 * 每个流式请求跑在虚拟线程上，不再受固定 8 线程池限制。
 *
 * @author Via Scholar
 */
public abstract class BaseModelAdapter {

    private static final int HTTP_OK = 200;
    private static final ExecutorService EXECUTOR =
            Executors.newVirtualThreadPerTaskExecutor();

    protected static final ObjectMapper MAPPER = new ObjectMapper();
    protected static final HttpClient HTTP = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(15)).build();

    /**
     * 返回厂商标识。
     *
     * @return deepseek / zhipu / qwen / moonshot / minimax / mimo
     */
    public abstract String getProviderCode();

    /**
     * 将统一请求转为厂商原生 JSON 请求体。
     */
    protected abstract String buildNativeBody(UnifiedChatRequest req) throws Exception;

    /**
     * 流式调用厂商 API。
     *
     * @param req        统一请求
     * @param onChunk    收到片段时回调
     * @param onError    出错时回调
     * @param onComplete 完成时回调
     * @param onUsage    上游返回 token 用量时回调（可能多次，最后一次为准）
     */
    public void streamChat(UnifiedChatRequest req,
                           Consumer<UnifiedStreamChunk> onChunk,
                           Consumer<Throwable> onError,
                           Runnable onComplete,
                           Consumer<UsageInfo> onUsage) {
        EXECUTOR.submit(() -> {
            try {
                String body = buildNativeBody(req);
                String url = buildUrl(req);

                HttpRequest httpReq = HttpRequest.newBuilder()
                        .uri(URI.create(url))
                        .header("Content-Type", "application/json")
                        .header("Authorization", "Bearer " + req.getApiKey())
                        .timeout(Duration.ofSeconds(300))
                        .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                        .build();

                HttpResponse<java.io.InputStream> resp =
                        HTTP.send(httpReq, HttpResponse.BodyHandlers.ofInputStream());

                if (resp.statusCode() != HTTP_OK) {
                    byte[] err = resp.body().readAllBytes();
                    String detail = new String(err, StandardCharsets.UTF_8);
                    if (detail.length() > 1000) {
                        detail = detail.substring(0, 1000) + "…";
                    }
                    onError.accept(new RuntimeException(
                            "HTTP " + resp.statusCode() + ": " + detail));
                    return;
                }

                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (!line.startsWith("data:")) {
                            continue;
                        }
                        String data = line.substring(5).trim();
                        if (data.isEmpty()) {
                            continue;
                        }
                        if ("[DONE]".equals(data)) {
                            break;
                        }
                        JsonNode node;
                        try {
                            node = MAPPER.readTree(data);
                        } catch (Exception ignored) {
                            continue;
                        }

                        JsonNode delta = firstDelta(node);
                        if (delta != null) {
                            String reasoning = textOf(delta.get("reasoning_content"));
                            if (reasoning != null) {
                                onChunk.accept(UnifiedStreamChunk.reasoning(reasoning));
                            }
                            String content = textOf(delta.get("content"));
                            if (content != null) {
                                onChunk.accept(UnifiedStreamChunk.chunk(content));
                            }
                        }

                        UsageInfo usage = extractUsage(node);
                        if (usage != null && onUsage != null) {
                            try {
                                onUsage.accept(usage);
                            } catch (Exception ignored) {
                                // 指标回调失败不应中断回答
                            }
                        }
                    }
                }
                onComplete.run();
            } catch (Exception e) {
                onError.accept(e);
            }
        });
    }

    private static JsonNode firstDelta(JsonNode node) {
        JsonNode choices = node.get("choices");
        if (choices == null || !choices.isArray() || choices.isEmpty()) {
            return null;
        }
        JsonNode choice = choices.get(0);
        return choice == null ? null : choice.get("delta");
    }

    private static String textOf(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        String text = node.asText("");
        return text.isEmpty() ? null : text;
    }

    /**
     * 解析 OpenAI 兼容 usage；DeepSeek 在流式响应的最后一个 chunk 携带。
     */
    protected UsageInfo extractUsage(JsonNode root) {
        JsonNode usage = root.get("usage");
        if (usage == null || usage.isNull() || !usage.isObject()) {
            return null;
        }
        UsageInfo info = new UsageInfo();
        info.setPromptTokens(usage.path("prompt_tokens").asInt(0));
        info.setCompletionTokens(usage.path("completion_tokens").asInt(0));
        info.setTotalTokens(usage.path("total_tokens").asInt(0));
        info.setCacheHitTokens(usage.path("prompt_cache_hit_tokens").asInt(0));
        info.setCacheMissTokens(usage.path("prompt_cache_miss_tokens").asInt(0));

        int hit = info.getCacheHitTokens();
        int miss = info.getCacheMissTokens();
        if (hit + miss == 0 && info.getPromptTokens() > 0) {
            info.setCacheMissTokens(info.getPromptTokens());
        } else if (info.getPromptTokens() == 0 && hit + miss > 0) {
            info.setPromptTokens(hit + miss);
        }
        if (info.getTotalTokens() == 0) {
            info.setTotalTokens(info.getPromptTokens() + info.getCompletionTokens());
        }
        return info;
    }

    private String buildUrl(UnifiedChatRequest req) {
        if (req.getBaseUrl() != null && !req.getBaseUrl().isBlank()) {
            String base = req.getBaseUrl().trim();
            // baseUrl 由请求方提供，属于不可信输入，限制协议避免 file: 被带进 HTTP 客户端。
            // 刻意不封禁内网/回环地址——本地 Ollama、LM Studio 等自建服务依赖该能力。
            String lower = base.toLowerCase(Locale.ROOT);
            if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
                throw new IllegalArgumentException("baseUrl 必须以 http:// 或 https:// 开头");
            }
            while (base.endsWith("/")) {
                base = base.substring(0, base.length() - 1);
            }
            return base + "/chat/completions";
        }
        return "https://api.deepseek.com/chat/completions";
    }
}
