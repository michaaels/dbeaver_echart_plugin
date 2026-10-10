package org.example.dbeaver.echarts;

import com.google.gson.JsonObject;
import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Named values become JDBC bindings, never SQL text or identifiers. */
final class ReportParameters {
    record Binding(String type, Object value) {
        void bind(PreparedStatement statement, int index) throws SQLException {
            switch (type) {
                case "number" -> statement.setBigDecimal(index, (BigDecimal) value);
                case "date" -> statement.setDate(index, java.sql.Date.valueOf((LocalDate) value));
                case "boolean" -> statement.setBoolean(index, (Boolean) value);
                default -> statement.setString(index, (String) value);
            }
        }
    }
    record Plan(String sql, List<Binding> bindings) { }
    private ReportParameters() { }

    static Plan prepare(String sql, JsonObject values) {
        if (values == null) return new Plan(sql, List.of());
        if (values.size() > 32) throw new IllegalArgumentException("Too many report parameters.");
        StringBuilder query = new StringBuilder();
        List<Binding> bindings = new ArrayList<>();
        for (int i = 0; i < sql.length();) {
            char c = sql.charAt(i);
            int start = i;
            if (c == '\'' || c == '"' || c == '`' || c == '[') {
                char closing = c == '[' ? ']' : c;
                boolean closed = false;
                for (i++; i < sql.length(); i++) {
                    if (sql.charAt(i) == '\\') throw new IllegalArgumentException("Ambiguous SQL string escaping.");
                    if (sql.charAt(i) != closing) continue;
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == closing) { i++; continue; }
                    i++; closed = true; break;
                }
                if (!closed) throw new IllegalArgumentException("Unclosed SQL string.");
                query.append(sql, start, i); continue;
            }
            if (sql.startsWith("--", i)) {
                while (i < sql.length() && sql.charAt(i) != '\n' && sql.charAt(i) != '\r') i++;
                query.append(sql, start, i); continue;
            }
            if (sql.startsWith("/*", i)) {
                int end = sql.indexOf("*/", i + 2);
                if (end < 0) throw new IllegalArgumentException("Unclosed SQL comment.");
                i = end + 2; query.append(sql, start, i); continue;
            }
            if (c == '$') {
                int tagEnd = sql.indexOf('$', i + 1);
                if (tagEnd >= 0 && sql.substring(i + 1, tagEnd).matches("[A-Za-z_][A-Za-z_0-9]*|")) {
                    String tag = sql.substring(i, tagEnd + 1);
                    int end = sql.indexOf(tag, tagEnd + 1);
                    if (end < 0) throw new IllegalArgumentException("Unclosed SQL dollar string.");
                    i = end + tag.length(); query.append(sql, start, i); continue;
                }
            }
            if (c == ':' && (i == 0 || sql.charAt(i - 1) != ':') && i + 1 < sql.length()
                && (Character.isLetter(sql.charAt(i + 1)) || sql.charAt(i + 1) == '_')) {
                i += 2;
                while (i < sql.length() && (Character.isLetterOrDigit(sql.charAt(i)) || sql.charAt(i) == '_')) i++;
                String name = sql.substring(start + 1, i);
                if (!values.has(name) || !values.get(name).isJsonObject()) throw new IllegalArgumentException("Missing report parameter: " + name);
                bindings.add(binding(values.getAsJsonObject(name)));
                if (bindings.size() > 256) throw new IllegalArgumentException("Too many parameter occurrences.");
                query.append('?'); continue;
            }
            if (c == '?') throw new IllegalArgumentException("Use named report parameters such as :start_date.");
            query.append(c); i++;
        }
        return new Plan(query.toString(), List.copyOf(bindings));
    }
    private static Binding binding(JsonObject parameter) {
        String type = JsonFields.string(parameter, "type"), value = JsonFields.string(parameter, "value");
        if (value.length() > 2000) throw new IllegalArgumentException("Report parameter exceeds 2000 characters.");
        return switch (type) {
            case "text" -> new Binding(type, value);
            case "number" -> {
                BigDecimal number = new BigDecimal(value);
                if (number.precision() > 100 || Math.abs(number.scale()) > 100) throw new IllegalArgumentException("Report number is out of range.");
                yield new Binding(type, number);
            }
            case "date" -> new Binding(type, LocalDate.parse(value));
            case "boolean" -> {
                if (!"true".equals(value) && !"false".equals(value)) throw new IllegalArgumentException("Invalid boolean parameter.");
                yield new Binding(type, Boolean.valueOf(value));
            }
            default -> throw new IllegalArgumentException("Unsupported report parameter type.");
        };
    }
}
