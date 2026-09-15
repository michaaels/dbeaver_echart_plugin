package org.example.dbeaver.echarts;

import org.eclipse.core.runtime.IProgressMonitor;
import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.jobs.Job;
import org.eclipse.core.runtime.Status;

import java.util.function.Consumer;

/**
 * Converts the current DBeaver result set away from the SWT UI thread.
 */
final class EChartsSnapshotJob extends Job {
    private final DBeaverResultSetAdapter adapter;
    private final Consumer<String> onSuccess;
    private final Consumer<RuntimeException> onFailure;

    EChartsSnapshotJob(
        DBeaverResultSetAdapter adapter,
        Consumer<String> onSuccess,
        Consumer<RuntimeException> onFailure
    ) {
        super("Build ECharts result snapshot");
        this.adapter = adapter;
        this.onSuccess = onSuccess;
        this.onFailure = onFailure;
        setSystem(true);
        setPriority(Job.SHORT);
    }

    @Override
    protected IStatus run(IProgressMonitor monitor) {
        if (monitor.isCanceled()) {
            return Status.CANCEL_STATUS;
        }
        try {
            String snapshot = adapter.snapshotAsJson();
            if (!monitor.isCanceled()) {
                onSuccess.accept(snapshot);
            }
            return monitor.isCanceled() ? Status.CANCEL_STATUS : Status.OK_STATUS;
        } catch (RuntimeException e) {
            if (!monitor.isCanceled()) {
                onFailure.accept(e);
            }
            return new Status(IStatus.ERROR, EChartsPreferences.PLUGIN_ID, "Could not build ECharts snapshot", e);
        }
    }
}
