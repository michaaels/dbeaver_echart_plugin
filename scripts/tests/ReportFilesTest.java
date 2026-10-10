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
            checkDashboardConversion(folder);
            checkTableConfiguration();
            JsonObject report = JsonParser.parseString(ReportFiles.empty()).getAsJsonObject();
            report.addProperty("title", "Conexión y región\nResumen"); report.addProperty("password", "secret");
            JsonObject source = JsonParser.parseString("{\"id\":\"daily\",\"name\":\"Diario\",\"connectionId\":\"local\",\"sql\":\"SELECT 'niño' AS zona, :date AS fecha;\",\"password\":\"secret\",\"rows\":[[1]]}").getAsJsonObject();
            report.getAsJsonArray("sources").add(source);
            JsonObject chart = JsonParser.parseString("{\"id\":\"sales\",\"type\":\"chart\",\"title\":\"Ventas\",\"sourceId\":\"daily\",\"config\":{\"chart\":{\"chartType\":\"bar\",\"xColumn\":\"zona\",\"yColumns\":[\"ventas\"],\"yAxes\":{\"ventas\":\"right\",\"password\":\"secret\"},\"marks\":{\"markLine\":true,\"password\":\"secret\"}}}}").getAsJsonObject();
            report.getAsJsonArray("widgets").add(chart);
            Path file = folder.resolve("red.echarts-report.json");
            ReportFiles.write(file, report.toString());
            String saved = ReportFiles.read(file), sql = Files.readString(DocumentFiles.sqlPath(file));
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
            Files.writeString(DocumentFiles.sqlPath(file), "-- Manual SQL\nSELECT 1;"); fail(() -> ReportFiles.write(file, report.toString())); check(ReportFiles.read(file).equals(saved), "Companion collision changed JSON");
            fail(() -> ReportFiles.parse(" ".repeat(ReportFiles.MAX_BYTES + 1)));
            Path html = folder.resolve("report.html"); ReportFiles.export(html, "<p>Región</p>"); check(Files.readString(html).equals("<p>Región</p>"), "UTF-8 export");
            var describer = new ReportContentDescriber();
            check(describer.describe(new ByteArrayInputStream(saved.getBytes(StandardCharsets.UTF_8)), null) == IContentDescriber.VALID, "Report content type");
            check(describer.describe(new ByteArrayInputStream("{\"setting\":1}".getBytes()), null) == IContentDescriber.INVALID, "Ordinary JSON hijacked");
            System.out.println("Report files OK: dashboard conversion/layout round trip, UTF-8 JSON/SQL, credential isolation, chart options, default lifecycle, parent/source validation, companion collision and content routing");
        } finally {
            try (var files = Files.list(folder)) { for (Path file : files.toList()) Files.delete(file); } Files.delete(folder);
        }
    }
    private static void checkDashboardConversion(Path folder) throws Exception {
        JsonObject dashboard = JsonParser.parseString("""
            {"title":"Sales dashboard","widgets":[
              {"id":"sales","title":"Daily sales","layout":{"x":2,"y":3,"width":6,"height":12,"password":"secret"},
               "source":{"project":"General","connection":"Local","connectionId":"local-id","sql":"SELECT fecha, SUM(ventas) AS ventas, SUM(costos) AS costos FROM echarts_test_sales GROUP BY fecha;","password":"secret","rows":[[1]]},
               "chart":{"chartType":"line","xColumn":"fecha","yColumns":["ventas","costos"],"yAxes":{"ventas":"left","costos":"right"},"marks":{"markLine":true}}},
              {"id":"costs","title":"Costs","layout":{"x":8,"y":3,"width":4,"height":12},
               "source":{"connectionId":"local-id","sql":"SELECT SUM(costos) AS costos FROM echarts_test_sales"},
               "chart":{"chartType":"bar","yColumns":["costos"]}},
              {"id":"default","title":"Default layout","source":{"sql":"SELECT 1 AS ventas"},"chart":{"chartType":"bar","yColumns":["ventas"]}}
            ]}
            """).getAsJsonObject();
        String converted = ReportFiles.fromDashboard(dashboard.toString());
        JsonObject report = ReportFiles.parse(converted);
        check(report.get("title").getAsString().equals("Sales dashboard"), "Dashboard title lost");
        check(report.getAsJsonArray("widgets").size() == 3 && report.getAsJsonArray("sources").size() == 3, "Dashboard components or queries lost");
        for (int index = 0; index < 3; index++) {
            JsonObject old = dashboard.getAsJsonArray("widgets").get(index).getAsJsonObject();
            JsonObject widget = report.getAsJsonArray("widgets").get(index).getAsJsonObject();
            JsonObject source = report.getAsJsonArray("sources").get(index).getAsJsonObject();
            check(widget.get("id").equals(old.get("id")) && widget.get("title").equals(old.get("title")), "Widget identity lost");
            check(widget.get("type").getAsString().equals("chart") && widget.get("sourceId").equals(source.get("id")), "Converted source binding lost");
            check(source.get("sql").equals(old.getAsJsonObject("source").get("sql")), "Executed SQL changed during conversion");
            if (old.has("layout")) {
                JsonObject expected = old.getAsJsonObject("layout").deepCopy(); expected.remove("password");
                check(widget.getAsJsonObject("layout").equals(expected), "Dashboard widget position or size lost");
            } else check(widget.getAsJsonObject("layout").size() == 0, "Missing layout should use designer defaults");
        }
        JsonObject chart = report.getAsJsonArray("widgets").get(0).getAsJsonObject().getAsJsonObject("config").getAsJsonObject("chart");
        check(chart.getAsJsonArray("yColumns").size() == 2 && chart.getAsJsonObject("yAxes").get("costos").getAsString().equals("right")
            && chart.getAsJsonObject("marks").get("markLine").getAsBoolean(), "Converted chart options lost");
        check(!converted.contains("secret") && !converted.contains("rows"), "Dashboard conversion leaked runtime data or credentials");
        Path file = folder.resolve("converted.echarts-report.json");
        ReportFiles.write(file, converted);
        check(ReportFiles.read(file).equals(converted), "Converted dashboard cannot be saved and reopened");
        check(Files.readString(DocumentFiles.sqlPath(file)).contains("SELECT fecha, SUM(ventas) AS ventas"), "Converted SQL companion lost");
        JsonObject invalid = dashboard.deepCopy();
        invalid.getAsJsonArray("widgets").get(0).getAsJsonObject().getAsJsonObject("layout").add("x", new JsonObject());
        fail(() -> ReportFiles.fromDashboard(invalid.toString()));
    }
    private static void checkTableConfiguration() throws Exception {
        JsonObject report = JsonParser.parseString(ReportFiles.empty()).getAsJsonObject();
        report.getAsJsonArray("parameters").add(JsonParser.parseString(
            "{\"name\":\"start_date\",\"type\":\"date\",\"default\":\"2026-10-01\",\"value\":\"2026-11-01\"}"));
        report.getAsJsonArray("sources").add(JsonParser.parseString(
            "{\"id\":\"daily\",\"sql\":\"SELECT fecha, ventas FROM sales WHERE fecha >= :start_date\"}"));
        JsonObject table = JsonParser.parseString("""
            {"id":"sales-table","type":"table","sourceId":"daily","layout":{"x":6,"y":2,"width":6,"height":26},
             "config":{"pageSize":10,"totals":true,"sortColumn":"fecha","sortDirection":"desc","groupBy":"fecha",
              "visibility":{"enabled":true,"column":"ventas","operator":"gt","value":"0","password":"secret"},
              "columns":[{"name":"ventas","label":"Ventas netas","format":"currency","width":160,"align":"right","total":true,
                "rule":{"enabled":true,"operator":"lt","value":"100","color":"#b42318","background":"#fff4f2"}}],
              "rows":[["private result"]]}}
            """).getAsJsonObject();
        report.getAsJsonArray("widgets").add(table);
        JsonObject saved = ReportFiles.parse(ReportFiles.canonical(report.toString()));
        JsonObject restored = saved.getAsJsonArray("widgets").get(0).getAsJsonObject();
        JsonObject config = restored.getAsJsonObject("config"), expected = table.getAsJsonObject("config");
        check(restored.get("layout").equals(table.get("layout")), "Table height and position changed");
        for (String field : new String[] { "pageSize", "totals", "sortColumn", "sortDirection", "groupBy", "columns" }) {
            check(config.get(field).equals(expected.get(field)), "Table setting lost: " + field);
        }
        JsonObject visibility = expected.getAsJsonObject("visibility").deepCopy(); visibility.remove("password");
        check(config.get("visibility").equals(visibility), "Visibility rule changed");
        check(!config.has("rows") && !saved.toString().contains("secret"), "Runtime data or credentials persisted");
        JsonObject parameter = saved.getAsJsonArray("parameters").get(0).getAsJsonObject();
        check(parameter.get("default").getAsString().equals("2026-10-01") && !parameter.has("value"),
            "Parameter definition and runtime value were mixed");
        check(ReportFiles.canonical(saved.toString()).equals(ReportFiles.canonical(report.toString())),
            "Normalized table settings changed on reopen");
    }

    private interface Action { void run() throws Exception; }
    private static void fail(Action action) throws Exception { try { action.run(); } catch (Exception expected) { return; } throw new AssertionError("Expected rejection"); }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
