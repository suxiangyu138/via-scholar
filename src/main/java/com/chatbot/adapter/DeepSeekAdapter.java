package com.chatbot.adapter;

import com.chatbot.model.UnifiedChatRequest;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

/**
 * DeepSeek — 原生 OpenAI 兼容。
 * <p>
 * 打开 stream_options.include_usage，让上游在最后一个 chunk 返回 token 用量与缓存命中。
 *
 * @author Via Scholar
 */
@Component
public class DeepSeekAdapter extends BaseModelAdapter {

    @Override
    public String getProviderCode() { return "deepseek"; }

    @Override
    protected String buildNativeBody(UnifiedChatRequest req) throws Exception {
        return buildOpenAiBody(req, true);
    }

    static String buildOpenAiBody(UnifiedChatRequest req, boolean includeUsage)
            throws Exception {
        ObjectNode root = MAPPER.createObjectNode();
        root.put("model", req.getModelName());
        root.put("stream", true);
        if (req.getTemperature() != null) {
            root.put("temperature", req.getTemperature());
        }
        if (req.getMaxTokens() != null) {
            root.put("max_tokens", req.getMaxTokens());
        }
        if (includeUsage) {
            root.putObject("stream_options").put("include_usage", true);
        }
        ArrayNode msgs = MAPPER.createArrayNode();
        if (req.getMessages() != null) {
            for (var m : req.getMessages()) {
                ObjectNode o = MAPPER.createObjectNode();
                o.put("role", m.getRole());
                if (m.getContentParts() != null && !m.getContentParts().isEmpty()) {
                    o.set("content", MAPPER.valueToTree(m.getContentParts()));
                } else {
                    o.put("content", m.getContent());
                }
                msgs.add(o);
            }
        }
        root.set("messages", msgs);
        return MAPPER.writeValueAsString(root);
    }

    /** 其它 OpenAI 兼容厂商使用的旧入口，默认不请求 usage。 */
    static String buildOpenAiBody(UnifiedChatRequest req, String defaultBase)
            throws Exception {
        return buildOpenAiBody(req, false);
    }
}
