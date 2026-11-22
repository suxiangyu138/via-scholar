package com.chatbot.adapter;

import com.chatbot.model.UnifiedChatRequest;
import org.springframework.stereotype.Component;

/**
 * 阿里通义千问 — OpenAI 兼容协议
 *
 * @author Via Scholar
 */
@Component
public class QwenAdapter extends BaseModelAdapter {

    @Override
    public String getProviderCode() { return "qwen"; }

    @Override
    protected String buildNativeBody(UnifiedChatRequest req) throws Exception {
        return DeepSeekAdapter.buildOpenAiBody(
                req, "https://dashscope.aliyuncs.com/compatible-mode/v1");
    }
}
