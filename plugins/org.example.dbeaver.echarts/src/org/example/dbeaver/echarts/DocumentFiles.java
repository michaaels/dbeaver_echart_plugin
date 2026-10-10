package org.example.dbeaver.echarts;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

/** Shared UTF-8 persistence; each document format owns its validation and SQL. */
final class DocumentFiles {
    private DocumentFiles() { }

    static Path sqlPath(Path file) {
        String name = file.getFileName().toString();
        return file.resolveSibling((name.endsWith(".json") ? name.substring(0, name.length() - 5) : name) + ".sql");
    }

    static void writeWithSqlCompanion(Path file, String json, String sql, String header, String collisionMessage)
        throws IOException {
        Path companion = sqlPath(file);
        if (Files.exists(companion)) {
            try (var reader = Files.newBufferedReader(companion, StandardCharsets.UTF_8)) {
                String firstLine = reader.readLine();
                if (firstLine == null || !firstLine.startsWith(header)) {
                    throw new IOException(collisionMessage);
                }
            }
        }
        // The pair is not transactional. JSON is authoritative and commits
        // last; another save regenerates SQL if the JSON commit fails.
        atomicWrite(companion, sql);
        atomicWrite(file, json);
    }

    static void atomicWrite(Path file, String text) throws IOException {
        Path target = file.toAbsolutePath().normalize();
        Path temporary = Files.createTempFile(target.getParent(), ".echarts-", ".tmp");
        try {
            Files.writeString(temporary, text, StandardCharsets.UTF_8);
            try {
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException ignored) {
                Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } finally {
            Files.deleteIfExists(temporary);
        }
    }
}
