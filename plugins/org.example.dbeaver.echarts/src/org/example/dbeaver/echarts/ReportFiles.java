package org.example.dbeaver.echarts;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/** Templates contain only definitions; exported reports contain execution snapshots. */
final class ReportFiles {
    static final String FORMAT = "dbeaver-echarts-report";
    static final String SUFFIX = ".echarts-report.json";
    static final int MAX_BYTES = 8_388_608;
    static final int MAX_EXPORT_BYTES = 33_554_432;
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().disableHtmlEscaping().create();
    private static final Set<String> TYPES = Set.of("heading", "text", "image", "kpi", "chart", "table", "line", "rectangle", "section", "header", "footer", "date");
    private ReportFiles() { }

    static JsonObject parse(String text) {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IllegalArgumentException("Report template exceeds 8 MiB.");
        JsonObject input = JsonParser.parseString(text).getAsJsonObject();
        if (!FORMAT.equals(DashboardFiles.string(input, "format")) || input.get("schemaVersion").getAsInt() != 1
            || !input.has("widgets") || !input.has("sources")) throw new IllegalArgumentException("Unsupported report template format.");
        JsonObject report = fields(input, "format", "schemaVersion", "title", "description", "category", "defaultTemplate");
        report.add("page", fields(object(input, "page"), "width", "margin", "gap", "background", "grid"));
        JsonArray parameters = input.has("parameters") ? input.getAsJsonArray("parameters") : new JsonArray();
        if (parameters.size() > 32) throw new IllegalArgumentException("Too many report parameters.");
        JsonArray cleanParameters = new JsonArray();
        Set<String> names = new HashSet<>();
        for (var element : parameters) {
            JsonObject parameter = fields(element.getAsJsonObject(), "name", "label", "type", "default");
            String name = DashboardFiles.string(parameter, "name");
            if (!name.matches("[A-Za-z_][A-Za-z_0-9]{0,63}") || !names.add(name)
                || !Set.of("text", "number", "date", "boolean").contains(DashboardFiles.string(parameter, "type"))) {
                throw new IllegalArgumentException("Invalid or duplicate report parameter.");
            }
            cleanParameters.add(parameter);
        }
        report.add("parameters", cleanParameters);
        JsonArray sources = input.getAsJsonArray("sources"), widgets = input.getAsJsonArray("widgets");
        if (sources.size() > 24 || widgets.size() > 64) throw new IllegalArgumentException("Report limit: 24 queries and 64 components.");
        JsonArray cleanSources = new JsonArray(), cleanWidgets = new JsonArray();
        Set<String> sourceIds = new HashSet<>(), widgetIds = new HashSet<>();
        for (var element : sources) {
            JsonObject source = fields(element.getAsJsonObject(), "id", "name", "project", "connection", "connectionId", "sql", "maxRows");
            String id = DashboardFiles.string(source, "id");
            if (id.isBlank() || id.length() > 200 || !sourceIds.add(id) || DashboardFiles.string(source, "sql").length() > 100_000) {
                throw new IllegalArgumentException("Invalid or duplicate report query.");
            }
            source.addProperty("kind", "savedQuery"); cleanSources.add(source);
        }
        Map<String, JsonObject> components = new HashMap<>();
        for (var element : widgets) {
            JsonObject inputWidget = element.getAsJsonObject();
            JsonObject widget = fields(inputWidget, "id", "type", "title", "parentId", "sourceId");
            String id = DashboardFiles.string(widget, "id"), type = DashboardFiles.string(widget, "type"), sourceId = DashboardFiles.string(widget, "sourceId");
            if (id.isBlank() || id.length() > 200 || !widgetIds.add(id) || !TYPES.contains(type) || (!sourceId.isBlank() && !sourceIds.contains(sourceId))) {
                throw new IllegalArgumentException("Invalid component or missing report source.");
            }
            widget.add("layout", fields(object(inputWidget, "layout"), "x", "y", "width", "height"));
            widget.add("style", fields(object(inputWidget, "style"), "color", "background", "borderColor", "borderWidth", "padding", "fontSize", "fontFamily", "align"));
            JsonObject inputConfig = object(inputWidget, "config");
            JsonObject config = fields(inputConfig, "text", "image", "alt", "column", "aggregate", "numberFormat", "decimals", "prefix", "suffix", "totals", "groupBy", "pageSize", "sortColumn", "sortDirection");
            String image = DashboardFiles.string(config, "image");
            if (!image.isBlank() && (!image.matches("data:image/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+") || image.length() > 2_800_000)) {
                throw new IllegalArgumentException("Use a local PNG, JPEG, GIF or WebP image under 2 MiB.");
            }
            JsonObject inputChart = object(inputConfig, "chart");
            JsonObject chart = fields(inputChart, "chartType", "xColumn", "yColumns", "colors", "legend");
            chart.add("marks", fields(object(inputChart, "marks"), "markLine", "markArea", "visualMap"));
            JsonObject axes = new JsonObject();
            for (var axis : object(inputChart, "yAxes").entrySet()) {
                if (axis.getKey().length() <= 200 && axis.getValue().isJsonPrimitive()
                    && Set.of("left", "right").contains(axis.getValue().getAsString())) axes.add(axis.getKey(), axis.getValue().deepCopy());
            }
            chart.add("yAxes", axes); config.add("chart", chart);
            config.add("visibility", fields(object(inputConfig, "visibility"), "enabled", "column", "operator", "value"));
            JsonArray columns = new JsonArray();
            if (inputConfig.has("columns")) {
                if (inputConfig.getAsJsonArray("columns").size() > 100) throw new IllegalArgumentException("Too many report table columns.");
                for (var column : inputConfig.getAsJsonArray("columns")) {
                    JsonObject clean = fields(column.getAsJsonObject(), "name", "label", "format", "width", "align", "total");
                    clean.add("rule", fields(object(column.getAsJsonObject(), "rule"), "enabled", "operator", "value", "color", "background"));
                    columns.add(clean);
                }
            }
            config.add("columns", columns); widget.add("config", config); cleanWidgets.add(widget); components.put(id, widget);
        }
        for (JsonObject widget : components.values()) {
            JsonObject ancestor = widget;
            for (int depth = 0; !DashboardFiles.string(ancestor, "parentId").isBlank(); depth++) {
                ancestor = components.get(DashboardFiles.string(ancestor, "parentId"));
                if (ancestor == null || ancestor == widget || depth >= 3 || !Set.of("section", "header", "footer").contains(DashboardFiles.string(ancestor, "type"))) {
                    throw new IllegalArgumentException("Invalid or cyclic report section.");
                }
            }
        }
        report.add("sources", cleanSources); report.add("widgets", cleanWidgets);
        return report;
    }
    private static JsonObject object(JsonObject input, String name) {
        return input.has(name) && input.get(name).isJsonObject() ? input.getAsJsonObject(name) : new JsonObject();
    }
    private static JsonObject fields(JsonObject input, String... names) {
        JsonObject clean = new JsonObject();
        for (String name : names) if (input.has(name)) {
            var value = input.get(name);
            if (value.isJsonObject()) throw new IllegalArgumentException("Invalid nested report field: " + name);
            if (value.isJsonArray()) {
                if (!Set.of("yColumns", "colors").contains(name) || value.getAsJsonArray().size() > 12) throw new IllegalArgumentException("Invalid report list: " + name);
                for (var item : value.getAsJsonArray()) if (!item.isJsonPrimitive() || !item.getAsJsonPrimitive().isString() || item.getAsString().length() > 200) throw new IllegalArgumentException("Invalid report list value.");
            }
            clean.add(name, value.deepCopy());
        }
        return clean;
    }
    static String canonical(String text) { return GSON.toJson(parse(text)); }
    static String read(Path path) throws IOException {
        if (Files.size(path) > MAX_BYTES) throw new IOException("Report template exceeds 8 MiB.");
        return canonical(Files.readString(path, StandardCharsets.UTF_8));
    }
    static String empty() {
        return "{\"format\":\"" + FORMAT + "\",\"schemaVersion\":1,\"title\":\"Untitled report\",\"sources\":[],\"widgets\":[],\"parameters\":[]}";
    }
    static String fromDashboard(String text) {
        JsonObject dashboard = JsonParser.parseString(text).getAsJsonObject(), report = JsonParser.parseString(empty()).getAsJsonObject();
        report.addProperty("title", DashboardFiles.string(dashboard, "title"));
        int index = 0;
        for (var element : dashboard.getAsJsonArray("widgets")) {
            JsonObject old = element.getAsJsonObject(), query = old.getAsJsonObject("source").deepCopy();
            String sourceId = "query-" + ++index;
            query.addProperty("id", sourceId); report.getAsJsonArray("sources").add(query);
            JsonObject component = fields(old, "id", "title", "layout");
            component.addProperty("type", "chart"); component.addProperty("sourceId", sourceId);
            JsonObject config = new JsonObject(); config.add("chart", old.getAsJsonObject("chart").deepCopy());
            component.add("config", config); report.getAsJsonArray("widgets").add(component);
        }
        return canonical(report.toString());
    }
    static void write(Path path, String text) throws IOException {
        JsonObject report = parse(text);
        String json = GSON.toJson(report) + "\n";
        if (json.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("Report template exceeds 8 MiB.");
        Path companion = DashboardFiles.sqlPath(path);
        if (Files.exists(companion)) {
            try (var reader = Files.newBufferedReader(companion, StandardCharsets.UTF_8)) {
                String first = reader.readLine();
                if (first == null || !first.startsWith("-- ECharts report:")) throw new IOException("The SQL companion is not an ECharts report file. Choose another name.");
            }
        }
        StringBuilder sql = new StringBuilder("-- ECharts report: " + DashboardFiles.string(report, "title").replaceAll("[\\r\\n]", " ") + "\n-- Generated from the report JSON.\n\n");
        for (var element : report.getAsJsonArray("sources")) {
            JsonObject source = element.getAsJsonObject();
            String query = DashboardFiles.string(source, "sql").stripTrailing();
            sql.append("-- Query: ").append(DashboardFiles.string(source, "name").replaceAll("[\\r\\n]", " ")).append('\n')
                .append(query).append(query.endsWith(";") ? "\n\n" : "\n;\n\n");
        }
        DashboardFiles.atomicWrite(companion, sql.toString());
        DashboardFiles.atomicWrite(path, json);
    }
    static void export(Path path, String content) throws IOException {
        if (content.getBytes(StandardCharsets.UTF_8).length > MAX_EXPORT_BYTES) throw new IOException("Generated report exceeds 32 MiB. Reduce rows or image sizes.");
        DashboardFiles.atomicWrite(path, content);
    }
    static void updateDefault(Path folder, Path file, boolean enabled) throws IOException {
        Path root = folder.toAbsolutePath().normalize(), target = file.toAbsolutePath().normalize();
        if (!target.startsWith(root)) return;
        Path marker = root.resolve(".default-template");
        String relative = root.relativize(target).toString();
        if (enabled) DashboardFiles.atomicWrite(marker, relative);
        else if (Files.exists(marker) && Files.size(marker) <= 4096 && Files.readString(marker).trim().equals(relative)) Files.delete(marker);
    }
}
