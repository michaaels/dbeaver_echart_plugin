package org.example.dbeaver.echarts;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;

/** Optional JSON strings never coerce numbers, flags or nested values to text. */
final class JsonFields {
    private JsonFields() { }

    static String string(JsonObject value, String key) {
        JsonElement element = value == null ? null : value.get(key);
        return element != null && element.isJsonPrimitive() && element.getAsJsonPrimitive().isString()
            ? element.getAsString() : "";
    }
}
