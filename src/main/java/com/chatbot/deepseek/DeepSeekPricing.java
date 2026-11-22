package com.chatbot.deepseek;

import org.springframework.stereotype.Service;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;

/**
 * DeepSeek 官方价格估算。
 * <p>
 * 价格来源：DeepSeek Models & Pricing（USD / 1M tokens）；前端按固定汇率折算人民币展示。
 * 高峰时段为 UTC 周一至周五 01:00-04:00、06:00-10:00，其余时段为低峰（五折）。
 * 官方说明中国法定节假日全天按低峰计价，这里未接节假日表，费用按“估算”展示。
 *
 * @author Via Scholar
 */
@Service
public class DeepSeekPricing {

    /** 每百万 token 的美元单价 */
    public record Rate(double cacheHit, double cacheMiss, double output) {
        Rate half() {
            return new Rate(cacheHit / 2, cacheMiss / 2, output / 2);
        }
    }

    private static final Rate FLASH_PEAK = new Rate(0.006, 0.30, 1.20);
    private static final Rate PRO_PEAK = new Rate(0.044, 1.32, 3.96);

    public boolean isPeak() {
        return isPeak(Instant.now());
    }

    boolean isPeak(Instant instant) {
        ZonedDateTime utc = instant.atZone(ZoneOffset.UTC);
        DayOfWeek day = utc.getDayOfWeek();
        if (day == DayOfWeek.SATURDAY || day == DayOfWeek.SUNDAY) {
            return false;
        }
        int hour = utc.getHour();
        return (hour >= 1 && hour < 4) || (hour >= 6 && hour < 10);
    }

    /**
     * 返回模型当前时段费率；未知模型返回 null（前端显示“费用 —”）。
     */
    public Rate rateFor(String model, boolean peak) {
        String name = model == null ? "" : model.toLowerCase();
        if (name.contains("v4-pro") || name.contains("reasoner") || name.startsWith("deepseek-r1")) {
            return peak ? PRO_PEAK : PRO_PEAK.half();
        }
        if (name.contains("flash") || name.contains("deepseek-chat")) {
            return peak ? FLASH_PEAK : FLASH_PEAK.half();
        }
        return null;
    }

    /**
     * 计算一次调用的估算费用（美元）。
     *
     * @param model            模型名
     * @param cacheHitTokens   缓存命中的输入 token
     * @param cacheMissTokens  缓存未命中的输入 token
     * @param completionTokens 输出 token
     * @return 美元费用；模型费率未知时返回 null
     */
    public Double costUsd(String model, int cacheHitTokens, int cacheMissTokens,
                          int completionTokens) {
        boolean peak = isPeak();
        Rate rate = rateFor(model, peak);
        if (rate == null) {
            return null;
        }
        double cost = cacheHitTokens / 1_000_000.0 * rate.cacheHit()
                + cacheMissTokens / 1_000_000.0 * rate.cacheMiss()
                + completionTokens / 1_000_000.0 * rate.output();
        return cost;
    }
}
