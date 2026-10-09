package org.example.dbeaver.echarts;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.eclipse.core.runtime.content.IContentDescriber;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Native template boundary: definitions only, atomic persistence and editor routing. */
public final class ReportFilesTest {
    public static void main(String[] args) throws Exception {
        Path folder = Files.createTempDirectory("echarts-reports-test-");
        try {
            JsonObject report = JsonParser.parseString(ReportFiles.empty()).getAsJsonObject();
            report.addProperty("title", "Conexión y región\nResumen"); report.addProperty("password", "secret");
            JsonObject source = JsonParser.parseString("{\"id\":\"daily\",\"name\":\"Diario\",\"connectionId\":\"local\",\"sql\":\"SELECT 'niño' AS zona, :date AS fecha;\",\"password\":\"secret\",\"rows\":[[1]]}").getAsJsonObject();
            report.getAsJsonArray("sources").add(source);
            JsonObject chart = JsonParser.parseString("{\"id\":\"sales\",\"type\":\"chart\",\"title\":\"Ventas\",\"sourceId\":\"daily\",\"config\":{\"chart\":{\"chartType\":\"bar\",\"xColumn\":\"zona\",\"yColumns\":[\"ventas\"],\"yAxes\":{\"ventas\":\"right\",\"password\":\"secret\"},\"marks\":{\"markLine\":true,\"password\":\"secret\"}}}}").getAsJsonObject();
            report.getAsJsonArray("widgets").add(chart);
            Path file = folder.resolve("red.echarts-report.json");
            ReportFiles.write(file, report.toString());
            String saved = ReportFiles.read(file), sql = Files.readString(DashboardFiles.sqlPath(file));
            check(!saved.contains("secret") && !saved.contains("rows"), "Runtime/credentials escaped the template boundary");
            check(sql.contains("SELECT 'niño' AS zona, :date AS fecha;"), "Exact Unicode SQL lost");
            check(!sql.contains(";\n;"), "Duplicate SQL terminator");
            check(sql.startsWith("-- ECharts report: Conexión y región Resumen"), "Multiline title escaped SQL comment");
            ReportFiles.write(file, saved); check(ReportFiles.read(file).equals(saved), "Round trip changed definition");
            ReportFiles.updateDefault(folder, file, true); check(Files.readString(folder.resolve(".default-template")).equals(file.getFileName().toString()), "Default pointer missing");
            ReportFiles.updateDefault(folder, folder.resolve("other.echarts-report.json"), false); check(Files.exists(folder.resolve(".default-template")), "Cleared unrelated default");
            ReportFiles.updateDefault(folder, file, false); check(!Files.exists(folder.resolve(".default-template")), "Default not cleared");
            ReportFiles.updateDefault(folder, folder.getParent().resolve("outside.echarts-report.json"), true); check(!Files.exists(folder.resolve(".default-template")), "Default path escaped project");
            report.addProperty("schemaVersion", 99); fail(() -> ReportFiles.write(file, report.toString())); check(ReportFiles.read(file).equals(saved), "Invalid save changed existing file"); report.addProperty("schemaVersion", 1);
            chart.addProperty("parentId", "sales"); fail(() -> ReportFiles.parse(report.toString())); chart.remove("parentId");
            chart.addProperty("sourceId", "missing"); fail(() -> ReportFiles.parse(report.toString())); chart.addProperty("sourceId", "daily");
            report.getAsJsonArray("widgets").add(chart.deepCopy()); fail(() -> ReportFiles.parse(report.toString())); report.getAsJsonArray("widgets").remove(1);
            chart.getAsJsonObject("config").addProperty("image", "data:image/svg+xml;base64,PHN2Zz4="); fail(() -> ReportFiles.parse(report.toString())); chart.getAsJsonObject("config").remove("image");
            Files.writeString(DashboardFiles.sqlPath(file), "-- Manual SQL\nSELECT 1;"); fail(() -> ReportFiles.write(file, report.toString())); check(ReportFiles.read(file).equals(saved), "Companion collision changed JSON");
            fail(() -> ReportFiles.parse(" ".repeat(ReportFiles.MAX_BYTES + 1)));
            Path html = folder.resolve("report.html"); ReportFiles.export(html, "<p>Región</p>"); check(Files.readString(html).equals("<p>Región</p>"), "UTF-8 export");
            var describer = new ReportContentDescriber();
            check(describer.describe(new ByteArrayInputStream(saved.getBytes(StandardCharsets.UTF_8)), null) == IContentDescriber.VALID, "Report content type");
            check(describer.describe(new ByteArrayInputStream("{\"setting\":1}".getBytes()), null) == IContentDescriber.INVALID, "Ordinary JSON hijacked");
            System.out.println("Report files OK: UTF-8 JSON/SQL, credential isolation, chart options, default lifecycle, parent/source validation, companion collision and content routing");
        } finally {
            try (var files = Files.list(folder)) { for (Path file : files.toList()) Files.delete(file); } Files.delete(folder);
        }
    }
    private interface Action { void run() throws Exception; }
    private static void fail(Action action) throws Exception { try { action.run(); } catch (Exception expected) { return; } throw new AssertionError("Expected rejection"); }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
