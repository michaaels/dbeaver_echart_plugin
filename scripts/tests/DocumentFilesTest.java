package org.example.dbeaver.echarts;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Failure and collision boundaries of the shared document persistence. */
public final class DocumentFilesTest {
    public static void main(String[] args) throws Exception {
        Path folder = Files.createTempDirectory("echarts-document-files-");
        try {
            Path file = folder.resolve("región.echarts-report.json");
            Path sql = DocumentFiles.sqlPath(file);
            String original = "{\"title\":\"Región\"}\n";
            Files.writeString(file, original, StandardCharsets.UTF_8);
            for (String collision : new String[] { "", "-- Manual SQL\nSELECT 7;", "-- ECharts dashboard: Sales\nSELECT 1;" }) {
                Files.writeString(sql, collision, StandardCharsets.UTF_8);
                expectIoFailure(() -> DocumentFiles.writeWithSqlCompanion(file, "replacement", "-- ECharts report: New\n",
                    "-- ECharts report:", "companion collision"));
                check(Files.readString(file).equals(original), "Collision must preserve the authoritative JSON");
                check(Files.readString(sql).equals(collision), "Collision must preserve unrelated SQL");
            }
            Files.writeString(sql, "-- ECharts report: Previous\n", StandardCharsets.UTF_8);
            String replacement = "{\"title\":\"Niño y café\"}\n";
            String generatedSql = "-- ECharts report: Niño y café\nSELECT 'región';\n";
            DocumentFiles.writeWithSqlCompanion(file, replacement, generatedSql, "-- ECharts report:", "collision");
            check(Files.readString(file).equals(replacement) && Files.readString(sql).equals(generatedSql),
                "Generated pairs must replace both files with exact UTF-8 content");

            Path occupied = Files.createDirectory(folder.resolve("occupied"));
            Path child = occupied.resolve("keep.txt");
            Files.writeString(child, "keep");
            expectIoFailure(() -> DocumentFiles.atomicWrite(occupied, "cannot replace a nonempty directory"));
            check(Files.readString(child).equals("keep"), "A failed commit must preserve existing content");
            try (var paths = Files.list(folder)) {
                check(paths.noneMatch(path -> path.getFileName().toString().startsWith(".echarts-")),
                    "Failed commits must clean up their temporary files");
            }
            System.out.println("Document persistence OK: collision isolation, exact UTF-8 replacement and failed-commit cleanup");
        } finally {
            try (var paths = Files.walk(folder)) {
                for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }

    private static void expectIoFailure(Action action) throws Exception {
        try { action.run(); } catch (IOException expected) { return; }
        throw new AssertionError("Expected persistence failure");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    @FunctionalInterface private interface Action { void run() throws Exception; }
}
