package com.chatbot.attachment;

import jakarta.annotation.PostConstruct;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.Charset;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;

/**
 * 图片/文件附件：落盘、解析、拼接成模型可读内容。
 */
@Service
public class AttachmentService {

    private static final Path UPLOAD_DIR = Paths.get(
            System.getProperty("user.dir"), "data", "uploads");
    private static final int MAX_FILES = 50;
    private static final long MAX_FILE_BYTES = 20L * 1024 * 1024;
    private static final long MAX_TOTAL_BYTES = 100L * 1024 * 1024;
    private static final long MAX_IMAGE_TOTAL_BYTES = 25L * 1024 * 1024;
    private static final int MAX_TEXT_PER_FILE = 20_000;
    private static final int MAX_TEXT_TOTAL = 80_000;
    private static final int MAX_PDF_PAGES = 50;
    private static final Set<String> IMAGE_EXT = Set.of("png", "jpg", "jpeg", "webp", "gif");
    private static final Set<String> TEXT_EXT = Set.of(
            "txt", "md", "markdown", "csv", "json", "html", "htm", "tex", "log");

    private final Map<String, Meta> metas = new ConcurrentHashMap<>();

    public record Meta(String id, String name, String mime, String kind, Path path, long size) {}

    public record Payload(String text, List<Map<String, Object>> parts) {}

    @PostConstruct
    void init() {
        try {
            Files.createDirectories(UPLOAD_DIR);
            cleanupOldFiles();
        } catch (IOException ignored) {
            // 目录不可用时在真正上传时再报错
        }
    }

    public List<Map<String, Object>> store(MultipartFile[] files) {
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException("没有收到文件");
        }
        if (files.length > MAX_FILES) {
            throw new IllegalArgumentException("单次最多上传 " + MAX_FILES + " 个附件");
        }

        List<Prepared> prepared = new ArrayList<>();
        long total = 0;
        for (MultipartFile file : files) {
            if (file == null || file.isEmpty()) {
                continue;
            }
            String name = safeName(file.getOriginalFilename());
            String ext = extension(name);
            String kind = kindOf(ext);
            if (kind == null) {
                throw new IllegalArgumentException("不支持的文件类型：" + name
                        + "（支持图片、PDF、txt/md/csv/json/html/tex）");
            }
            long size = file.getSize();
            if (size > MAX_FILE_BYTES) {
                throw new IllegalArgumentException(name + " 超过 20MB");
            }
            total += size;
            if (total > MAX_TOTAL_BYTES) {
                throw new IllegalArgumentException("附件总大小超过 100MB");
            }
            prepared.add(new Prepared(file, name, ext, kind, size));
        }
        if (prepared.isEmpty()) {
            throw new IllegalArgumentException("没有收到有效文件");
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Prepared p : prepared) {
            String id = UUID.randomUUID().toString();
            Path target = UPLOAD_DIR.resolve(id + "." + p.ext);
            try {
                Files.createDirectories(UPLOAD_DIR);
                p.file.transferTo(target);
            } catch (Exception e) {
                throw new IllegalArgumentException("保存失败：" + p.name);
            }
            Meta meta = new Meta(id, p.name, mimeOf(p.ext, p.file.getContentType()),
                    p.kind, target, p.size);
            metas.put(id, meta);
            result.add(publicMeta(meta));
        }
        return result;
    }

    /**
     * 把文本与附件拼成模型消息内容；有图片时返回 content parts。
     */
    public Payload build(String userText, List<String> ids) {
        String text = userText == null ? "" : userText.trim();
        if (ids == null || ids.isEmpty()) {
            return new Payload(text, null);
        }
        if (ids.size() > MAX_FILES) {
            throw new IllegalArgumentException("单轮最多 " + MAX_FILES + " 个附件");
        }

        StringBuilder context = new StringBuilder(text);
        List<Map<String, Object>> images = new ArrayList<>();
        long imageBytes = 0;
        int textBudget = MAX_TEXT_TOTAL;

        for (String id : ids) {
            Meta meta = metas.get(id);
            if (meta == null) {
                throw new IllegalArgumentException("附件已过期，请重新上传");
            }
            if ("image".equals(meta.kind)) {
                imageBytes += meta.size;
                if (imageBytes > MAX_IMAGE_TOTAL_BYTES) {
                    throw new IllegalArgumentException("图片总量超过 25MB，请减少或压缩图片");
                }
                try {
                    byte[] bytes = Files.readAllBytes(meta.path);
                    images.add(imagePart(meta, bytes));
                } catch (IOException e) {
                    throw new IllegalArgumentException("读取图片失败：" + meta.name);
                }
            } else {
                String content = "pdf".equals(meta.kind) ? extractPdf(meta) : extractText(meta);
                if (content == null || content.isBlank()) {
                    continue;
                }
                content = truncate(content, MAX_TEXT_PER_FILE);
                if (textBudget <= 0) {
                    context.append("\n\n（附件内容过多，其余部分已省略）");
                    break;
                }
                if (content.length() > textBudget) {
                    content = truncate(content, textBudget);
                }
                context.append("\n\n【附件：").append(meta.name).append("】\n").append(content);
                textBudget -= content.length();
            }
        }

        if (context.length() == 0) {
            context.append("请根据上传的附件回答问题。");
        }
        String finalText = context.toString();
        if (images.isEmpty()) {
            return new Payload(finalText, null);
        }
        List<Map<String, Object>> parts = new ArrayList<>();
        Map<String, Object> textPart = new LinkedHashMap<>();
        textPart.put("type", "text");
        textPart.put("text", finalText);
        parts.add(textPart);
        parts.addAll(images);
        return new Payload(finalText, parts);
    }

    public void delete(String id) {
        if (id == null || id.isBlank()) {
            return;
        }
        Meta meta = metas.remove(id);
        if (meta != null) {
            try {
                Files.deleteIfExists(meta.path);
            } catch (IOException ignored) {
                // 文件删除失败不影响前端
            }
        }
    }

    private Map<String, Object> imagePart(Meta meta, byte[] bytes) {
        String encoded = Base64.getEncoder().encodeToString(bytes);
        Map<String, Object> imageUrl = new LinkedHashMap<>();
        imageUrl.put("url", "data:" + meta.mime + ";base64," + encoded);
        Map<String, Object> part = new LinkedHashMap<>();
        part.put("type", "image_url");
        part.put("image_url", imageUrl);
        return part;
    }

    private String extractPdf(Meta meta) {
        try (PDDocument doc = Loader.loadPDF(meta.path.toFile())) {
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setSortByPosition(true);
            if (doc.getNumberOfPages() > MAX_PDF_PAGES) {
                stripper.setEndPage(MAX_PDF_PAGES);
            }
            String text = cleanText(stripper.getText(doc));
            if (text.isBlank()) {
                return "（PDF 未提取到文本，可能是扫描版；请上传题目图片）";
            }
            return truncate(text, MAX_TEXT_PER_FILE);
        } catch (Exception e) {
            return "（PDF 解析失败：" + shortMessage(e) + "）";
        }
    }

    private String extractText(Meta meta) {
        try {
            byte[] bytes = Files.readAllBytes(meta.path);
            String text;
            try {
                text = StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(bytes)).toString();
            } catch (CharacterCodingException e) {
                text = new String(bytes, Charset.forName("GB18030"));
            }
            return truncate(cleanText(text), MAX_TEXT_PER_FILE);
        } catch (Exception e) {
            return "（文件读取失败：" + shortMessage(e) + "）";
        }
    }

    private static String cleanText(String text) {
        if (text == null) {
            return "";
        }
        return text.replace("\r\n", "\n").replace('\r', '\n')
                .replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "")
                .replaceAll("\n{3,}", "\n\n")
                .trim();
    }

    private static String truncate(String text, int max) {
        if (text == null) {
            return "";
        }
        if (text.length() <= max) {
            return text;
        }
        return text.substring(0, Math.max(0, max)) + "\n（内容过长，已截断）";
    }

    private static String shortMessage(Exception e) {
        String msg = e.getMessage();
        if (msg == null || msg.isBlank()) {
            return e.getClass().getSimpleName();
        }
        return msg.length() > 120 ? msg.substring(0, 120) + "…" : msg;
    }

    private static Map<String, Object> publicMeta(Meta meta) {
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("id", meta.id);
        item.put("name", meta.name);
        item.put("size", meta.size);
        item.put("kind", meta.kind);
        item.put("mime", meta.mime);
        return item;
    }

    private static String safeName(String name) {
        if (name == null || name.isBlank()) {
            return "file";
        }
        String value = name.replace('\\', '/');
        int slash = value.lastIndexOf('/');
        if (slash >= 0) {
            value = value.substring(slash + 1);
        }
        value = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (value.isEmpty()) {
            value = "file";
        }
        return value.length() > 120 ? value.substring(0, 120) : value;
    }

    private static String extension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) {
            return "";
        }
        return name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private static String kindOf(String ext) {
        if (IMAGE_EXT.contains(ext)) {
            return "image";
        }
        if ("pdf".equals(ext)) {
            return "pdf";
        }
        if (TEXT_EXT.contains(ext)) {
            return "text";
        }
        return null;
    }

    private static String mimeOf(String ext, String provided) {
        if (provided != null && provided.startsWith("image/")) {
            return provided;
        }
        if (provided != null && provided.equals("application/pdf")) {
            return provided;
        }
        return switch (ext) {
            case "png" -> "image/png";
            case "jpg", "jpeg" -> "image/jpeg";
            case "webp" -> "image/webp";
            case "gif" -> "image/gif";
            case "pdf" -> "application/pdf";
            default -> "text/plain; charset=utf-8";
        };
    }

    private void cleanupOldFiles() {
        try (Stream<Path> files = Files.list(UPLOAD_DIR)) {
            Instant cutoff = Instant.now().minus(24, ChronoUnit.HOURS);
            files.filter(Files::isRegularFile).forEach(p -> {
                try {
                    if (Files.getLastModifiedTime(p).toInstant().isBefore(cutoff)) {
                        Files.deleteIfExists(p);
                    }
                } catch (IOException ignored) {
                    // 跳过单个文件
                }
            });
        } catch (IOException ignored) {
            // 目录不存在或不可读
        }
    }

    private record Prepared(MultipartFile file, String name, String ext,
                            String kind, long size) {}
}
