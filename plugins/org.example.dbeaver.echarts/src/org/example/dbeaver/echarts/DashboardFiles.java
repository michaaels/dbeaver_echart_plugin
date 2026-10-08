package org.example.dbeaver.echarts;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.Set;

/** The JSON is authoritative; the SQL companion is generated from it. */
final class DashboardFiles {
    static final int MAX_BYTES = 1_048_576;
    static final String FORMAT = "dbeaver-echarts-dashboard";
    static final String SUFFIX = ".echarts-dashboard.json";
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();

    private DashboardFiles() { }

    static JsonObject parse(String text) {
        if (text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) {
            throw new IllegalArgumentException("Dashboard JSON exceeds 1 MiB.");
        }
        JsonObject document = JsonParser.parseString(text).getAsJsonObject();
        if (!document.has("schemaVersion") || document.get("schemaVersion").getAsInt() != 1
            || !document.has("widgets") || !document.get("widgets").isJsonArray()
            || (document.has("format") && !FORMAT.equals(string(document, "format")))) {
            throw new IllegalArgumentException("Unsupported ECharts dashboard format.");
        }
        if (document.getAsJsonArray("widgets").size() > 24) {
            throw new IllegalArgumentException("A dashboard supports up to 24 widgets.");
        }
        Set<String> ids = new HashSet<>();
        for (JsonElement element : document.getAsJsonArray("widgets")) {
            JsonObject widget = element.getAsJsonObject();
            String id = string(widget, "id");
            if (id.isBlank() || !ids.add(id)) throw new IllegalArgumentException("Invalid or duplicate widget ID.");
            JsonObject source = widget.getAsJsonObject("source");
            if (source == null || string(source, "sql").isBlank()) {
                throw new IllegalArgumentException("Widget \"" + string(widget, "title") + "\" has no SQL. Assign it in Edit.");
            }
            source.addProperty("kind", "savedQuery");
            JsonObject policy = widget.getAsJsonObject("refreshPolicy");
            if (policy != null && "onResult".equals(string(policy, "mode"))) policy.addProperty("mode", "manual");
        }
        document.addProperty("format", FORMAT);
        return document;
    }

    static String read(Path file) throws IOException {
        if (Files.size(file) > MAX_BYTES) throw new IOException("Dashboard JSON exceeds 1 MiB.");
        return GSON.toJson(parse(Files.readString(file, StandardCharsets.UTF_8)));
    }

    static String canonical(String text) { return GSON.toJson(parse(text)); }

    static String string(JsonObject value, String key) {
        JsonElement element = value == null ? null : value.get(key);
        return element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()
            ? element.getAsString() : "";
    }

    static Path sqlPath(Path file) {
        String name = file.getFileName().toString();
        return file.resolveSibling((name.endsWith(".json") ? name.substring(0, name.length() - 5) : name) + ".sql");
    }

    static String sqlDocument(JsonObject document) {
        StringBuilder sql = new StringBuilder("-- ECharts dashboard: " + comment(string(document, "title"))
            + "\n-- Generated from JSON. Edit widget queries with the dashboard Edit button.\n\n");
        for (JsonElement element : document.getAsJsonArray("widgets")) {
            JsonObject widget = element.getAsJsonObject();
            JsonObject source = widget.getAsJsonObject("source");
            sql.append("-- Widget: ").append(comment(string(widget, "title"))).append(" [")
                .append(comment(string(widget, "id"))).append("]\n-- Connection: ")
                .append(comment(string(source, "project"))).append(" / ")
                .append(comment(string(source, "connection"))).append('\n');
            String query = string(source, "sql");
            sql.append(query).append(query.stripTrailing().endsWith(";") ? "\n\n" : "\n;\n\n");
        }
        return sql.toString();
    }

    private static String comment(String text) { return text.replace('\r', ' ').replace('\n', ' '); }

    static void write(Path file, String text) throws IOException {
        JsonObject document = parse(text); // Validate before touching either file.
        String json = GSON.toJson(document) + "\n";
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("Dashboard JSON exceeds 1 MiB.");
        Path companion = sqlPath(file);
        if (Files.exists(companion)) {
            try (var reader = Files.newBufferedReader(companion, StandardCharsets.UTF_8)) {
                String firstLine = reader.readLine();
                if (firstLine == null || !firstLine.startsWith("-- ECharts dashboard: ")) {
                    throw new IOException("The SQL companion already exists and was not generated by ECharts. Choose another name.");
                }
            }
        }
        // Commit JSON last. A failed JSON write can leave an outdated generated companion;
        // reopening always reads JSON, and saving it regenerates the SQL copy.
        atomicWrite(sqlPath(file), sqlDocument(document));
        atomicWrite(file, json);
    }

    private static void atomicWrite(Path file, String text) throws IOException {
        Path target = file.toAbsolutePath().normalize();
        Path temporary = Files.createTempFile(target.getParent(), ".echarts-", ".tmp");
        try {
            Files.writeString(temporary, text, StandardCharsets.UTF_8);
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally { Files.deleteIfExists(temporary); }
    }
}
