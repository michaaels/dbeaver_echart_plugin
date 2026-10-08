package org.example.dbeaver.echarts;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Conservative lexical guard. Database permissions remain the security boundary. */
final class DashboardSqlPolicy {
    private static final Set<String> START = Set.of("SELECT", "WITH", "SHOW", "EXPLAIN", "DESCRIBE", "DESC");
    private static final Set<String> FORBIDDEN = Set.of(
        "INSERT", "UPDATE", "DELETE", "MERGE", "DROP", "ALTER", "TRUNCATE", "CREATE", "GRANT", "REVOKE",
        "CALL", "EXECUTE", "EXEC", "INTO", "LOCK", "UNLOCK", "SHARE", "ANALYZE", "COPY", "VACUUM", "ATTACH", "DETACH",
        "NEXTVAL", "SETVAL", "GET_LOCK", "RELEASE_LOCK", "PG_ADVISORY_LOCK", "PG_TRY_ADVISORY_LOCK",
        "PG_ADVISORY_XACT_LOCK", "PG_TRY_ADVISORY_XACT_LOCK", "DBLINK_EXEC", "LOAD_FILE", "XP_CMDSHELL"
    );

    private DashboardSqlPolicy() { }

    static boolean accepts(String sql) {
        if (sql == null || sql.isBlank() || sql.length() > 1_000_000) return false;
        List<String> tokens = new ArrayList<>();
        for (int i = 0; i < sql.length();) {
            char c = sql.charAt(i);
            if (Character.isWhitespace(c)) { i++; continue; }
            if (c == '-' && i + 1 < sql.length() && sql.charAt(i + 1) == '-'
                && (i + 2 == sql.length() || Character.isWhitespace(sql.charAt(i + 2)))) {
                while (i < sql.length() && sql.charAt(i) != '\n' && sql.charAt(i) != '\r') i++;
                continue;
            }
            if (c == '/' && i + 1 < sql.length() && sql.charAt(i + 1) == '*') {
                if (i + 2 < sql.length() && (sql.charAt(i + 2) == '!'
                    || (sql.charAt(i + 2) == 'M' && i + 3 < sql.length() && sql.charAt(i + 3) == '!'))) return false;
                int end = sql.indexOf("*/", i + 2);
                if (end < 0 || sql.substring(i + 2, end).contains("/*")) return false;
                i = end + 2;
                continue;
            }
            if (c == '\'' || c == '"' || c == '`' || c == '[') {
                char closing = c == '[' ? ']' : c;
                boolean closed = false;
                for (i++; i < sql.length(); i++) {
                    // Backslash escaping has incompatible meanings across SQL dialects.
                    if (sql.charAt(i) == '\\') return false;
                    if (sql.charAt(i) != closing) continue;
                    if (i + 1 < sql.length() && sql.charAt(i + 1) == closing) { i++; continue; }
                    i++;
                    closed = true;
                    break;
                }
                if (!closed) return false;
                tokens.add("QUOTED");
                continue;
            }
            if (c == '$') {
                int tagEnd = sql.indexOf('$', i + 1);
                if (tagEnd >= 0 && sql.substring(i + 1, tagEnd).matches("[A-Za-z_][A-Za-z_0-9]*|")) {
                    String tag = sql.substring(i, tagEnd + 1);
                    int end = sql.indexOf(tag, tagEnd + 1);
                    if (end < 0) return false;
                    i = end + tag.length();
                    tokens.add("QUOTED");
                    continue;
                }
            }
            if (Character.isLetter(c) || c == '_') {
                int start = i++;
                while (i < sql.length() && (Character.isLetterOrDigit(sql.charAt(i)) || sql.charAt(i) == '_')) i++;
                String token = sql.substring(start, i).toUpperCase(Locale.ROOT);
                if (FORBIDDEN.contains(token) || token.startsWith("PG_ADVISORY_") || token.startsWith("PG_TRY_ADVISORY_")) return false;
                tokens.add(token);
            } else {
                tokens.add(String.valueOf(c));
                i++;
            }
        }
        if (tokens.isEmpty() || !START.contains(tokens.getFirst())) return false;
        for (int i = 0; i + 2 < tokens.size(); i++) {
            if (tokens.get(i).equals("NEXT") && tokens.get(i + 1).equals("VALUE") && tokens.get(i + 2).equals("FOR")) return false;
        }
        int semicolon = tokens.indexOf(";");
        return semicolon < 0 || semicolon == tokens.size() - 1;
    }
}
