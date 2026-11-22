package com.chatbot.deepseek;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * DeepSeek 账户接口客户端：上游模型列表、账户余额。
 * <p>
 * API Key 由前端随请求传入，本类不持久化、不打印。
 *
 * @author Via Scholar
 */
@Service
public class DeepSeekApiClient {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final int HTTP_OK = 200;
    private static final HttpClient HTTP = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(10))
            .build();

    public List<Map<String, Object>> listModels(String apiKey, String baseUrl) throws IOException {
        JsonNode root = get(apiRoot(baseUrl) + "/models", apiKey);
        JsonNode data = root.path("data");
        List<Map<String, Object>> models = new ArrayList<>();
        if (!data.isArray()) {
            return models;
        }
        for (JsonNode node : data) {
            String id = node.path("id").asText("");
            if (id.isBlank()) {
                continue;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", id);
            item.put("name", node.path("name").asText(id));
            item.put("ownedBy", node.path("owned_by").asText(""));
            if (node.has("context_window")) {
                item.put("contextWindow", node.path("context_window").asLong());
            }
            if (node.has("max_output_tokens")) {
                item.put("maxOutputTokens", node.path("max_output_tokens").asLong());
            }
            JsonNode effort = node.path("effort");
            if (effort.has("default_level")) {
                item.put("defaultEffort", effort.path("default_level").asText(""));
            }
            JsonNode inputs = node.path("input_modalities");
            if (inputs.isArray()) {
                List<String> modalities = new ArrayList<>();
                for (JsonNode modality : inputs) {
                    modalities.add(modality.asText(""));
                }
                item.put("inputModalities", modalities);
            }
            models.add(item);
        }
        return models;
    }

    public Map<String, Object> getBalance(String apiKey, String baseUrl) throws IOException {
        JsonNode root = get(apiRoot(baseUrl) + "/user/balance", apiKey);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("isAvailable", root.path("is_available").asBoolean(false));
        List<Map<String, Object>> balances = new ArrayList<>();
        JsonNode infos = root.path("balance_infos");
        if (infos.isArray()) {
            for (JsonNode node : infos) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("currency", node.path("currency").asText(""));
                item.put("totalBalance", node.path("total_balance").asText("0"));
                item.put("grantedBalance", node.path("granted_balance").asText("0"));
                item.put("toppedUpBalance", node.path("topped_up_balance").asText("0"));
                balances.add(item);
            }
        }
        result.put("balances", balances);
        return result;
    }

    private JsonNode get(String url, String apiKey) throws IOException {
        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Authorization", "Bearer " + apiKey)
                .header("Accept", "application/json")
                .timeout(Duration.ofSeconds(20))
                .GET()
                .build();
        try {
            HttpResponse<String> response = HTTP.send(request,
                    HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() != HTTP_OK) {
                throw new IOException("HTTP " + response.statusCode() + ": " + truncate(response.body()));
            }
            return MAPPER.readTree(response.body());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("请求被中断", e);
        }
    }

    /**
     * 把前端填写的 baseUrl 归一化成 DeepSeek 根地址。
     * 支持 https://api.deepseek.com、带 /v1 的 OpenAI 兼容地址。
     */
    static String apiRoot(String baseUrl) {
        String value = baseUrl == null ? "" : baseUrl.trim();
        if (value.isEmpty()) {
            return "https://api.deepseek.com";
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        if (value.toLowerCase().endsWith("/v1")) {
            value = value.substring(0, value.length() - 3);
        }
        if (value.toLowerCase().endsWith("/chat/completions")) {
            value = value.substring(0, value.length() - "/chat/completions".length());
        }
        return value;
    }

    private static String truncate(String text) {
        if (text == null) {
            return "";
        }
        return text.length() > 300 ? text.substring(0, 300) + "…" : text;
    }
}
