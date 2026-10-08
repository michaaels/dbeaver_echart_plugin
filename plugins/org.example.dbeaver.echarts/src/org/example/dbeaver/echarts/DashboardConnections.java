package org.example.dbeaver.echarts;

import com.google.gson.JsonObject;
import org.jkiss.dbeaver.model.DBPDataSourceContainer;
import org.jkiss.dbeaver.model.DBUtils;
import org.jkiss.dbeaver.model.app.DBPProject;
import org.jkiss.dbeaver.model.exec.DBCExecutionContext;
import org.jkiss.dbeaver.runtime.DBWorkbench;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Bind local IDs, never copy JDBC URLs, passwords or connection configuration. */
final class DashboardConnections {
    private DashboardConnections() { }

    static String list() {
        List<Map<String, Object>> connections = new ArrayList<>();
        for (DBPProject project : DBWorkbench.getPlatform().getWorkspace().getProjects()) {
            if (!project.isOpen() || !project.isRegistryLoaded()) continue;
            for (DBPDataSourceContainer container : project.getDataSourceRegistry().getDataSources()) {
                Map<String, Object> source = new LinkedHashMap<>();
                source.put("project", project.getName());
                source.put("connectionId", container.getId());
                source.put("connection", container.getName());
                connections.add(source);
            }
        }
        return JsonWriter.write(connections);
    }

    static DBCExecutionContext resolve(JsonObject source, DBPProject fallbackProject) {
        String projectName = DashboardFiles.string(source, "project");
        DBPProject project = projectName.isBlank() ? fallbackProject
            : DBWorkbench.getPlatform().getWorkspace().getProject(projectName);
        if (project == null || !project.isOpen()) {
            throw new IllegalStateException("Dashboard project is unavailable. Choose a connection in Edit.");
        }
        String id = DashboardFiles.string(source, "connectionId");
        DBPDataSourceContainer connection = id.isBlank() ? null : project.getDataSourceRegistry().getDataSource(id);
        // Legacy files only stored the name. Never silently substitute a different ID.
        if (id.isBlank()) {
            String name = DashboardFiles.string(source, "connection");
            List<? extends DBPDataSourceContainer> candidates = project.getDataSourceRegistry().getDataSources().stream()
                .filter(item -> item.getName().equals(name)).toList();
            if (candidates.size() == 1) connection = candidates.getFirst();
        }
        if (connection == null) {
            throw new IllegalStateException("Dashboard connection not found. Choose a connection in Edit.");
        }
        if (!connection.isConnected() || connection.getDataSource() == null) {
            throw new IllegalStateException("Connect \"" + connection.getName() + "\" in DBeaver, then Refresh this widget.");
        }
        DBCExecutionContext context = DBUtils.getDefaultContext(connection.getDataSource(), false);
        if (context == null) throw new IllegalStateException("No SQL execution context is available for this connection.");
        return context;
    }
}
