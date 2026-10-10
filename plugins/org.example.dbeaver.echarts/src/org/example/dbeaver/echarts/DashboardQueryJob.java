package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.Status;
import org.eclipse.core.runtime.jobs.Job;
import org.eclipse.core.runtime.jobs.JobGroup;
import org.eclipse.core.runtime.OperationCanceledException;
import org.jkiss.dbeaver.model.exec.DBCAttributeMetaData;
import org.jkiss.dbeaver.model.exec.DBCExecutionContext;
import org.jkiss.dbeaver.model.exec.DBCExecutionPurpose;
import org.jkiss.dbeaver.model.exec.DBCResultSet;
import org.jkiss.dbeaver.model.exec.DBCSession;
import org.jkiss.dbeaver.model.exec.DBCStatement;
import org.jkiss.dbeaver.model.exec.DBCStatementType;
import org.jkiss.dbeaver.model.runtime.AbstractJob;
import org.jkiss.dbeaver.model.runtime.DBRProgressMonitor;
import org.jkiss.dbeaver.model.runtime.VoidProgressMonitor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/** Executes a bounded dashboard query in an owned, isolated execution context. */
final class DashboardQueryJob extends AbstractJob {
    private static final JobGroup QUERIES = new JobGroup("ECharts dashboard queries", 4, 0) {
        @Override
        protected boolean shouldCancel(IStatus result, int failures, int cancellations) { return false; }
    };
    private enum Stop { NONE, CANCELLED, TIMEOUT }
    private final AtomicReference<Stop> stop = new AtomicReference<>(Stop.NONE);
    private final AtomicReference<DBCStatement> activeStatement = new AtomicReference<>();
    private volatile Thread worker;

    private final java.util.function.Supplier<DBCExecutionContext> context;
    private final String sql;
    private final int maxRows;
    private final int maxCells;
    private final int timeoutSeconds;
    private final Consumer<String> onSuccess;
    private final Consumer<Exception> onFailure;
    private final List<ReportParameters.Binding> parameters;

    DashboardQueryJob(
        java.util.function.Supplier<DBCExecutionContext> context,
        String sql,
        int maxRows,
        int maxCells,
        int timeoutSeconds,
        Consumer<String> onSuccess,
        Consumer<Exception> onFailure
    ) {
        this(context, sql, maxRows, maxCells, timeoutSeconds, onSuccess, onFailure, List.of());
    }

    DashboardQueryJob(java.util.function.Supplier<DBCExecutionContext> context, String sql, int maxRows, int maxCells,
                      int timeoutSeconds, Consumer<String> onSuccess, Consumer<Exception> onFailure,
                      List<ReportParameters.Binding> parameters) {
        super("Refresh ECharts dashboard widget");
        this.context = context;
        this.sql = sql;
        this.maxRows = Math.max(1, maxRows);
        this.maxCells = Math.max(1, maxCells);
        this.timeoutSeconds = Math.max(1, Math.min(3600, timeoutSeconds));
        this.onSuccess = onSuccess;
        this.onFailure = onFailure;
        this.parameters = List.copyOf(parameters);
        setSystem(true);
        setPriority(SHORT);
        setJobGroup(QUERIES);
    }

    void requestCancellation() {
        stop.compareAndSet(Stop.NONE, Stop.CANCELLED);
        cancel();
    }

    @Override
    protected void canceling() {
        stop.compareAndSet(Stop.NONE, Stop.CANCELLED);
        DBCStatement statement = activeStatement.get();
        Thread thread = worker;
        if (statement != null) {
            // JDBC cancellation may block: never run it on the SWT or deadline thread.
            Job.createSystem("Cancel ECharts widget query", (org.eclipse.core.runtime.ICoreRunnable) monitor -> {
                if (activeStatement.get() == statement) {
                    try { statement.cancelBlock(new VoidProgressMonitor(), thread); }
                    catch (Exception ignored) { /* Completion/timeout reporting stays on the owning job. */ }
                }
            }).schedule();
        }
    }

    @Override
    protected IStatus run(DBRProgressMonitor monitor) {
        worker = Thread.currentThread();
        Job deadline = Job.createSystem("ECharts query deadline", (org.eclipse.core.runtime.ICoreRunnable) ignored -> {
            if (stop.compareAndSet(Stop.NONE, Stop.TIMEOUT)) cancel();
        });
        deadline.schedule(timeoutSeconds * 1000L);
        try {
            checkCancelled(monitor);
            if (!isReadOnlyQuery(sql)) {
                throw new IllegalArgumentException("Dashboard SQL must be one permitted query without write or locking operations.");
            }
            String snapshot = execute(monitor);
            checkCancelled(monitor);
            onSuccess.accept(snapshot);
            return Status.OK_STATUS;
        } catch (Exception e) {
            if (stop.get() == Stop.TIMEOUT) {
                e = new IllegalStateException("The widget query exceeded " + timeoutSeconds + " seconds. Cancellation was requested.", e);
                onFailure.accept(e);
            } else if (!monitor.isCanceled() && stop.get() == Stop.NONE) {
                onFailure.accept(e);
            } else {
                return Status.CANCEL_STATUS;
            }
            return new Status(IStatus.ERROR, EChartsPreferences.PLUGIN_ID, "Could not refresh dashboard widget", e);
        } finally {
            deadline.cancel();
            activeStatement.set(null);
            worker = null;
        }
    }

    private void checkCancelled(DBRProgressMonitor monitor) {
        if (monitor.isCanceled() || stop.get() != Stop.NONE) throw new OperationCanceledException();
    }

    private DBCExecutionContext openContext(DBRProgressMonitor monitor) throws Exception {
        DBCExecutionContext source = context.get();
        checkCancelled(monitor);
        if (source == null || !source.isConnected()) throw new IllegalStateException("Connect the widget data source first.");
        if (source.getDataSource().getContainer().isForceUseSingleConnection()) {
            throw new IllegalStateException("Dashboard queries require a separate connection. Disable single-connection mode for this data source.");
        }
        DBCExecutionContext isolated = source.getOwnerInstance().openIsolatedContext(monitor, "ECharts dashboard", source);
        // Never close or use the editor context if a driver cannot provide isolation.
        if (isolated == null || isolated == source) throw new IllegalStateException("The driver did not provide an isolated dashboard context.");
        return isolated;
    }

    private String execute(DBRProgressMonitor monitor) throws Exception {
        try (
            DBCExecutionContext isolated = openContext(monitor);
            DBCSession session = isolated.openSession(monitor, DBCExecutionPurpose.USER, "ECharts dashboard widget");
            DBCStatement statement = prepare(session)
        ) {
            activeStatement.set(statement);
            checkCancelled(monitor);
            statement.setStatementTimeout(timeoutSeconds);
            statement.setLimit(0, maxRows);
            statement.setResultsFetchSize(Math.min(maxRows, 1_000));
            if (!statement.executeStatement()) {
                throw new IllegalStateException("The widget SQL did not return a result set.");
            }
            try (DBCResultSet resultSet = statement.openResultSet()) {
                List<? extends DBCAttributeMetaData> attributes = resultSet.getMeta().getAttributes();
                int columnCount = attributes.size();
                if (columnCount > maxCells) throw new IllegalStateException("The query column count exceeds the dashboard cell limit.");
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

    private DBCStatement prepare(DBCSession session) throws Exception {
        if (parameters.isEmpty()) return session.prepareStatement(DBCStatementType.QUERY, sql, false, false, false);
        if (!(session instanceof java.sql.Connection connection)) {
            throw new IllegalStateException("Typed report parameters require a JDBC connection.");
        }
        java.sql.PreparedStatement prepared = connection.prepareStatement(sql);
        try {
            if (!(prepared instanceof DBCStatement bounded)) throw new IllegalStateException("The JDBC driver does not expose bounded report statements.");
            for (int i = 0; i < parameters.size(); i++) parameters.get(i).bind(prepared, i + 1);
            return bounded;
        } catch (Exception error) { prepared.close(); throw error; }
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
        return DashboardSqlPolicy.accepts(query);
    }
}
