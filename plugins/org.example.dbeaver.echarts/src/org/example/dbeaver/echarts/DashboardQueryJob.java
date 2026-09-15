package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.Status;
import org.jkiss.dbeaver.model.exec.DBCAttributeMetaData;
import org.jkiss.dbeaver.model.exec.DBCExecutionContext;
import org.jkiss.dbeaver.model.exec.DBCExecutionPurpose;
import org.jkiss.dbeaver.model.exec.DBCResultSet;
import org.jkiss.dbeaver.model.exec.DBCSession;
import org.jkiss.dbeaver.model.exec.DBCStatement;
import org.jkiss.dbeaver.model.exec.DBCStatementType;
import org.jkiss.dbeaver.model.runtime.AbstractJob;
import org.jkiss.dbeaver.model.runtime.DBRProgressMonitor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;
import java.util.regex.Pattern;

/** Executes a bounded, read-only dashboard query on DBeaver's active execution context. */
final class DashboardQueryJob extends AbstractJob {
    private static final Pattern READ_ONLY_START = Pattern.compile(
        "(?is)^\\s*(?:--[^\\r\\n]*(?:\\r?\\n|$)|/\\*.*?\\*/\\s*)*(select|with|show|explain|describe|desc)\\b"
    );
    private static final Pattern MUTATING_KEYWORD = Pattern.compile(
        "(?i)\\b(insert|update|delete|merge|drop|alter|truncate|create|grant|revoke|call|execute)\\b"
    );

    private final DBCExecutionContext context;
    private final String sql;
    private final int maxRows;
    private final int maxCells;
    private final Consumer<String> onSuccess;
    private final Consumer<Exception> onFailure;

    DashboardQueryJob(
        DBCExecutionContext context,
        String sql,
        int maxRows,
        int maxCells,
        Consumer<String> onSuccess,
        Consumer<Exception> onFailure
    ) {
        super("Refresh ECharts dashboard widget");
        this.context = context;
        this.sql = sql;
        this.maxRows = Math.max(1, maxRows);
        this.maxCells = Math.max(1, maxCells);
        this.onSuccess = onSuccess;
        this.onFailure = onFailure;
        setSystem(true);
        setPriority(SHORT);
    }

    @Override
    protected IStatus run(DBRProgressMonitor monitor) {
        if (!isReadOnlyQuery(sql)) {
            IllegalArgumentException error = new IllegalArgumentException("Dashboard widgets only execute read-only SQL queries.");
            onFailure.accept(error);
            return new Status(IStatus.ERROR, EChartsPreferences.PLUGIN_ID, error.getMessage(), error);
        }
        try {
            String snapshot = execute(monitor);
            if (!monitor.isCanceled()) {
                onSuccess.accept(snapshot);
            }
            return monitor.isCanceled() ? Status.CANCEL_STATUS : Status.OK_STATUS;
        } catch (Exception e) {
            if (!monitor.isCanceled()) {
                onFailure.accept(e);
            }
            return new Status(IStatus.ERROR, EChartsPreferences.PLUGIN_ID, "Could not refresh dashboard widget", e);
        }
    }

    private String execute(DBRProgressMonitor monitor) throws Exception {
        try (
            DBCSession session = context.openSession(monitor, DBCExecutionPurpose.USER, "ECharts dashboard widget");
            DBCStatement statement = session.prepareStatement(DBCStatementType.QUERY, sql, false, false, false)
        ) {
            statement.setLimit(0, maxRows);
            statement.setResultsFetchSize(Math.min(maxRows, 1_000));
            if (!statement.executeStatement()) {
                throw new IllegalStateException("The widget SQL did not return a result set.");
            }
            try (DBCResultSet resultSet = statement.openResultSet()) {
                List<? extends DBCAttributeMetaData> attributes = resultSet.getMeta().getAttributes();
                int columnCount = attributes.size();
                int effectiveMaxRows = Math.min(maxRows, Math.max(1, maxCells / Math.max(1, columnCount)));
                List<List<Object>> rows = new ArrayList<>();
                while (rows.size() < effectiveMaxRows && !monitor.isCanceled() && resultSet.nextRow()) {
                    List<Object> row = new ArrayList<>(columnCount);
                    for (int column = 0; column < columnCount; column++) {
                        row.add(DBeaverResultSetAdapter.normalize(resultSet.getAttributeValue(column)));
                    }
                    rows.add(row);
                }
                return JsonWriter.write(snapshot(attributes, rows, effectiveMaxRows));
            }
        }
    }

    private Map<String, Object> snapshot(
        List<? extends DBCAttributeMetaData> attributes,
        List<List<Object>> rows,
        int effectiveMaxRows
    ) {
        List<Map<String, Object>> columns = new ArrayList<>(attributes.size());
        for (int index = 0; index < attributes.size(); index++) {
            DBCAttributeMetaData attribute = attributes.get(index);
            Map<String, Object> column = new LinkedHashMap<>();
            column.put("index", index);
            column.put("name", attribute.getLabel() == null || attribute.getLabel().isBlank() ? attribute.getName() : attribute.getLabel());
            column.put("kind", attribute.getDataKind().name());
            columns.add(column);
        }
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("schemaVersion", 1);
        source.put("kind", "savedQuery");
        source.put("sql", sql);

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("schemaVersion", 1);
        snapshot.put("columns", columns);
        snapshot.put("rows", rows);
        snapshot.put("rowCount", rows.size());
        snapshot.put("exportedRowCount", rows.size());
        snapshot.put("truncated", rows.size() >= effectiveMaxRows);
        snapshot.put("effectiveMaxRows", effectiveMaxRows);
        snapshot.put("defaultRenderer", EChartsPreferences.getDefaultRenderer());
        snapshot.put("source", source);
        return snapshot;
    }

    static boolean isReadOnlyQuery(String query) {
        if (query == null || query.isBlank() || query.length() > 1_000_000) {
            return false;
        }
        String normalized = query.trim().toLowerCase(Locale.ROOT);
        int semicolon = normalized.indexOf(';');
        if (semicolon >= 0 && !normalized.substring(semicolon + 1).isBlank()) {
            return false;
        }
        return READ_ONLY_START.matcher(query).find() && !MUTATING_KEYWORD.matcher(query).find();
    }
}
