package org.example.dbeaver.echarts;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.util.HashMap;
import java.util.Map;

/** Session-only approvals bound to the exact SQL and connection reference; never serialized. */
final class DashboardQueryApproval {
    private final Map<String, String> approved = new HashMap<>();

    boolean approve(String json) {
        if (json == null || json.length() > 1_048_576) return false;
        try {
            JsonArray queries = JsonParser.parseString(json).getAsJsonArray();
            if (queries.isEmpty() || queries.size() > 24) return false;
            Map<String, String> additions = new HashMap<>();
            for (var item : queries) {
                JsonObject query = item.getAsJsonObject();
                String id = JsonFields.string(query, "id");
                String sql = JsonFields.string(query, "sql");
                if (id.isBlank() || id.length() > 200 || sql.isBlank() || sql.length() > 1_000_000
                    || additions.containsKey(id)) return false;
                additions.put(id, signature(sql, query.getAsJsonObject("source")));
            }
            approved.putAll(additions);
            return true;
        } catch (RuntimeException invalid) { return false; }
    }

    boolean accepts(String id, String sql, JsonObject source) {
        return signature(sql, source).equals(approved.get(id));
    }

    void clear() { approved.clear(); }
    void revoke(String id) { approved.remove(id); }

    private static String signature(String sql, JsonObject source) {
        if (source == null) throw new IllegalArgumentException("Missing query source");
        JsonArray parts = new JsonArray();
        parts.add(sql);
        for (String field : new String[] {"kind", "project", "connectionId", "connection"}) {
            parts.add(JsonFields.string(source, field));
        }
        // Report approvals also bind typed values and per-source row limits.
        if (source.has("parameters")) parts.add(source.get("parameters"));
        if (source.has("maxRows")) parts.add(source.get("maxRows"));
        return parts.toString();
    }
}
