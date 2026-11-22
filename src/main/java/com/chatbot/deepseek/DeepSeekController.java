package com.chatbot.deepseek;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * DeepSeek 账户与模型接口。
 * <p>
 * 前端每次请求携带本机保存的 API Key，服务端只做转发，不落盘。
 *
 * @author Via Scholar
 */
@RestController
@RequestMapping("/api/deepseek")
public class DeepSeekController {

    private final DeepSeekApiClient client;

    public DeepSeekController(DeepSeekApiClient client) {
        this.client = client;
    }

    /** 获取上游最新模型列表 */
    @PostMapping("/models")
    public Map<String, Object> models(@RequestBody Map<String, String> body) {
        String apiKey = body.get("apiKey");
        if (apiKey == null || apiKey.isBlank()) {
            return error("缺少 API Key");
        }
        try {
            List<Map<String, Object>> models = client.listModels(apiKey, body.get("baseUrl"));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", true);
            result.put("models", models);
            return result;
        } catch (Exception e) {
            return error("获取模型失败: " + message(e));
        }
    }

    /** 获取账户余额 */
    @PostMapping("/balance")
    public Map<String, Object> balance(@RequestBody Map<String, String> body) {
        String apiKey = body.get("apiKey");
        if (apiKey == null || apiKey.isBlank()) {
            return error("缺少 API Key");
        }
        try {
            Map<String, Object> balance = client.getBalance(apiKey, body.get("baseUrl"));
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("success", true);
            result.putAll(balance);
            return result;
        } catch (Exception e) {
            return error("获取余额失败: " + message(e));
        }
    }

    private static String message(Exception e) {
        String msg = e.getMessage();
        if (msg == null || msg.isBlank()) {
            return e.getClass().getSimpleName();
        }
        return msg.length() > 300 ? msg.substring(0, 300) + "…" : msg;
    }

    private static Map<String, Object> error(String msg) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", false);
        result.put("error", msg);
        return result;
    }
}
