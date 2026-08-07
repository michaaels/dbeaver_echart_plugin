package org.example.dbeaver.echarts;

import java.lang.reflect.Array;
import java.util.Collection;
import java.util.Iterator;
import java.util.Map;

/**
 * Minimal JSON writer used by the browser bridge.
 *
 * Deliberately supports only JSON-safe primitives, collections, arrays and maps.
 * Database-specific objects must be normalized before they get here.
 */
final class JsonWriter {
    private JsonWriter() {
    }

    static String write(Object value) {
        StringBuilder out = new StringBuilder(4096);
        append(out, value);
        return out.toString();
    }

    private static void append(StringBuilder out, Object value) {
        if (value == null) {
            out.append("null");
        } else if (value instanceof String s) {
            appendString(out, s);
        } else if (value instanceof Character c) {
            appendString(out, c.toString());
        } else if (value instanceof Boolean b) {
            out.append(b.booleanValue());
        } else if (value instanceof Number n) {
            appendNumber(out, n);
        } else if (value instanceof Map<?, ?> map) {
            appendMap(out, map);
        } else if (value instanceof Collection<?> collection) {
            appendCollection(out, collection);
        } else if (value.getClass().isArray()) {
            appendArray(out, value);
        } else {
            appendString(out, String.valueOf(value));
        }
    }

    private static void appendNumber(StringBuilder out, Number number) {
        if (number instanceof Double d && !Double.isFinite(d)) {
            out.append("null");
            return;
        }
        if (number instanceof Float f && !Float.isFinite(f)) {
            out.append("null");
            return;
        }
        out.append(number.toString());
    }

    private static void appendMap(StringBuilder out, Map<?, ?> map) {
        out.append('{');
        Iterator<? extends Map.Entry<?, ?>> iterator = map.entrySet().iterator();
        boolean first = true;
        while (iterator.hasNext()) {
            if (!first) {
                out.append(',');
            }
            first = false;
            Map.Entry<?, ?> entry = iterator.next();
            appendString(out, String.valueOf(entry.getKey()));
            out.append(':');
            append(out, entry.getValue());
        }
        out.append('}');
    }

    private static void appendCollection(StringBuilder out, Collection<?> collection) {
        out.append('[');
        boolean first = true;
        for (Object item : collection) {
            if (!first) {
                out.append(',');
            }
            first = false;
            append(out, item);
        }
        out.append(']');
    }

    private static void appendArray(StringBuilder out, Object array) {
        out.append('[');
        int length = Array.getLength(array);
        for (int i = 0; i < length; i++) {
            if (i > 0) {
                out.append(',');
            }
            append(out, Array.get(array, i));
        }
        out.append(']');
    }

    private static void appendString(StringBuilder out, String value) {
        out.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20 || c == '\u2028' || c == '\u2029') {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
                }
            }
        }
        out.append('"');
    }
}
