package org.example.dbeaver.echarts;

import com.google.gson.JsonObject;
import org.eclipse.core.runtime.content.IContentDescriber;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** File persistence and format recognition tests; no DBeaver UI or database required. */
public final class DashboardFilesTest {
    public static void main(String[] arguments) throws Exception {
        Path folder = Files.createTempDirectory("echarts-files-test-");
        try {
            String query = "-- región y café\nSELECT 'niño; costa', 12.5 AS ventas;";
            JsonObject source = new JsonObject();
            source.addProperty("kind", "activeResultSet");
            source.addProperty("sql", query);
            source.addProperty("project", "General");
            source.addProperty("connectionId", "local-id");
            JsonObject widget = new JsonObject();
            widget.addProperty("id", "ventas");
            widget.addProperty("title", "Ventas\npor región");
            widget.add("source", source);
            JsonObject chart = new JsonObject();
            chart.addProperty("chartType", "map");
            widget.add("chart", chart);
            JsonObject document = new JsonObject();
            document.addProperty("schemaVersion", 1);
            document.addProperty("title", "Control de ventas");
            var widgets = new com.google.gson.JsonArray();
            widgets.add(widget);
            document.add("widgets", widgets);
            Path file = folder.resolve("control.echarts-dashboard.json");
            DashboardFiles.write(file, document.toString());
            JsonObject read = DashboardFiles.parse(DashboardFiles.read(file));
            check(read.get("format").getAsString().equals(DashboardFiles.FORMAT), "Legacy format upgraded");
            JsonObject restored = read.getAsJsonArray("widgets").get(0).getAsJsonObject();
            check(DashboardFiles.string(restored.getAsJsonObject("source"), "sql").equals(query), "Exact Unicode SQL");
            check(DashboardFiles.string(restored.getAsJsonObject("source"), "kind").equals("savedQuery"), "Independent source");
            check(DashboardFiles.string(restored.getAsJsonObject("chart"), "chartType").equals("map"), "Map configuration");
            Path sql = DashboardFiles.sqlPath(file);
            check(sql.getFileName().toString().equals("control.echarts-dashboard.sql"), "Distinct SQL companion");
            String companion = Files.readString(sql);
            check(companion.contains(query), "SQL preserved in companion");
            check(companion.contains("-- Widget: Ventas por región"), "Comment cannot create SQL lines");
            DashboardFiles.write(file, document.toString()); // Existing generated pair can be updated.
            String original = Files.readString(file);
            expectFailure(() -> DashboardFiles.write(file, "{bad json"));
            check(Files.readString(file).equals(original), "Invalid saves preserve existing JSON");
            source.addProperty("sql", " ");
            expectFailure(() -> DashboardFiles.write(file, document.toString()));
            check(Files.readString(file).equals(original), "Missing SQL preserves existing JSON");
            source.addProperty("sql", query);
            document.addProperty("schemaVersion", 99);
            expectFailure(() -> DashboardFiles.write(file, document.toString()));
            document.addProperty("schemaVersion", 1);
            widgets.add(widget.deepCopy());
            expectFailure(() -> DashboardFiles.parse(document.toString()));
            widgets.remove(1);
            Files.writeString(sql, "-- My own SQL\nSELECT 7;");
            expectFailure(() -> DashboardFiles.write(file, document.toString()));
            check(Files.readString(sql).equals("-- My own SQL\nSELECT 7;"), "Unrelated SQL never overwritten");
            check(Files.readString(file).equals(original), "Companion collision preserves JSON");
            expectFailure(() -> DashboardFiles.parse(" ".repeat(DashboardFiles.MAX_BYTES + 1)));
            var describer = new DashboardContentDescriber();
            check(describe(describer, original) == IContentDescriber.VALID, "Dashboard routing");
            check(describe(describer, "{\"setting\":1}") == IContentDescriber.INVALID, "Ordinary JSON routing");
            check(describe(describer, "{\"source\":{\"format\":\"dbeaver-echarts-dashboard\"}}") == IContentDescriber.INVALID,
                "Nested marker cannot hijack JSON routing");
            System.out.println("Dashboard file tests OK: UTF-8 SQL/JSON, map, migration, collision, invalid saves, content routing");
        } finally {
            try (var files = Files.list(folder)) { for (Path file : files.toList()) Files.delete(file); }
            Files.delete(folder);
        }
    }

    private static int describe(DashboardContentDescriber describer, String text) throws Exception {
        return describer.describe(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), null);
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private static void expectFailure(CheckedAction action) throws Exception {
        boolean failed = false;
        try { action.run(); } catch (Exception expected) { failed = true; }
        check(failed, "Expected invalid save to fail");
    }
    @FunctionalInterface private interface CheckedAction { void run() throws Exception; }
}
