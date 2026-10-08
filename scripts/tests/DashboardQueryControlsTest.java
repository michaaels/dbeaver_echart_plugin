package org.example.dbeaver.echarts;

import com.google.gson.JsonObject;
import org.jkiss.dbeaver.model.DBPDataSource;
import org.jkiss.dbeaver.model.DBPDataSourceContainer;
import org.jkiss.dbeaver.model.exec.*;
import org.jkiss.dbeaver.model.struct.DBSInstance;
import org.jkiss.dbeaver.model.app.DBPApplicationWorkbench;
import org.jkiss.dbeaver.model.app.DBPPlatform;
import org.jkiss.dbeaver.runtime.DBWorkbench;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Exercises real Eclipse scheduling and driver cancellation, without a UI or database writes. */
public final class DashboardQueryControlsTest {
    public static void main(String[] args) {
        try {
            installTestWorkbench();
            sqlPolicy();
            approvals();
            cancellation(false);
            cancellation(true);
            isolationFailure(false);
            isolationFailure(true);
            concurrency();
            System.out.println("Dashboard query controls OK: lexical policy, approval binding, timeout, cancellation, isolation, 4-query limit");
        } catch (Throwable error) {
            error.printStackTrace();
            System.exit(1);
        }
    }

    private static void installTestWorkbench() throws Exception {
        // AbstractJob's monitor checks platform shutdown. Supply that service only in this
        // isolated test JVM; all production scheduling/cancellation classes remain real.
        DBPPlatform platform = proxy(DBPPlatform.class, (object, method, args) -> {
            if (method.getName().equals("isShuttingDown")) return false;
            throw new AssertionError("Unexpected platform access: " + method.getName());
        });
        DBPApplicationWorkbench workbench = proxy(DBPApplicationWorkbench.class, (object, method, args) -> {
            if (method.getName().equals("getPlatform")) return platform;
            throw new AssertionError("Unexpected workbench access: " + method.getName());
        });
        var field = DBWorkbench.class.getDeclaredField("applicationWorkbench");
        field.setAccessible(true);
        field.set(null, workbench);
    }

    private static void sqlPolicy() {
        String[] accepted = {
            "SELECT 1", "-- sales\nSELECT 'update; delete' AS status; -- end",
            "SELECT 'it''s working', `update`, \"delete\", [drop] FROM sales",
            "WITH daily AS (SELECT 1 AS total) SELECT * FROM daily;",
            "SELECT $$update; delete$$ AS message", "SELECT $text$nextval; drop$text$",
            "/* update */ SELECT 1", "SHOW TABLES", "EXPLAIN SELECT 1", "DESCRIBE sales"
        };
        String[] rejected = {
            "", "SELECT 1; SELECT 2", "SELECT 1;;", "WITH x AS (DELETE FROM sales RETURNING *) SELECT * FROM x",
            "SELECT * INTO OUTFILE '/tmp/sales' FROM sales", "SELECT 1 INTO temp_table",
            "SELECT * FROM sales FOR UPDATE", "SELECT * FROM sales FOR SHARE",
            "SELECT nextval('seq')", "SELECT NEXT VALUE FOR seq", "SELECT setval('seq', 1)",
            "SELECT GET_LOCK('x', 10)", "SELECT pg_advisory_lock(1)", "SELECT load_file('/etc/passwd')",
            "EXPLAIN ANALYZE SELECT dangerous_function()", "SELECT 1 /*! INTO OUTFILE '/tmp/x' */",
            "SELECT 1 /*M! INTO OUTFILE '/tmp/x' */", "SELECT 'unterminated", "SELECT 1 /* unterminated",
            "SELECT 'back\\slash'", "SELECT 1 /* nested /* */", "SELECT 1--x; DELETE FROM sales"
        };
        for (String sql : accepted) check(DashboardSqlPolicy.accepts(sql), "Rejected permitted SQL: " + sql);
        for (String sql : rejected) check(!DashboardSqlPolicy.accepts(sql), "Accepted blocked SQL: " + sql);
        check(!DashboardSqlPolicy.accepts(null), "Null SQL");
    }

    private static void approvals() {
        DashboardQueryApproval approval = new DashboardQueryApproval();
        JsonObject source = new JsonObject();
        source.addProperty("kind", "savedQuery");
        source.addProperty("project", "General");
        source.addProperty("connectionId", "local-id");
        source.addProperty("connection", "Tests");
        check(!approval.accepts("w", "SELECT 1", source), "Unapproved query accepted");
        check(approval.approve("[{\"id\":\"w\",\"sql\":\"SELECT 1\",\"source\":" + source + "}]"), "Approval failed");
        check(approval.accepts("w", "SELECT 1", source), "Approved query rejected");
        check(!approval.accepts("w", "SELECT 2", source), "Changed SQL retained approval");
        source.addProperty("connectionId", "other-id");
        check(!approval.accepts("w", "SELECT 1", source), "Changed connection retained approval");
        source.addProperty("connectionId", "local-id");
        source.addProperty("project", "Other");
        check(!approval.accepts("w", "SELECT 1", source), "Changed project retained approval");
        source.addProperty("project", "General");
        check(!approval.approve("[{\"id\":\"x\",\"sql\":\"SELECT 1\",\"source\":{}},{\"id\":\"x\",\"sql\":\"SELECT 2\",\"source\":{}}]"), "Duplicate IDs accepted");
        check(!approval.accepts("x", "SELECT 1", new JsonObject()), "Partial approval leaked");
        approval.clear();
        check(!approval.accepts("w", "SELECT 1", source), "Reopening retained approval");
    }

    private static void cancellation(boolean timeout) throws Exception {
        Fixture fixture = new Fixture(false, false);
        AtomicReference<Exception> error = new AtomicReference<>();
        AtomicInteger success = new AtomicInteger();
        DashboardQueryJob job = fixture.job(timeout ? 1 : 30, success, error);
        job.schedule();
        check(fixture.started.await(5, TimeUnit.SECONDS), "Query did not start");
        check(fixture.timeout.get() == (timeout ? 1 : 30), "Driver timeout was not configured");
        if (!timeout) {
            long begin = System.nanoTime();
            job.requestCancellation();
            check(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - begin) < 500, "Cancellation blocked caller");
        }
        check(fixture.cancelled.await(5, TimeUnit.SECONDS), "Driver cancelBlock was not called");
        check(job.join(5000, null), "Query did not finish after cancellation");
        check(success.get() == 0, "Cancelled result was published");
        check(fixture.closed.get() == 1 && fixture.sharedClosed.get() == 0, "Context ownership violated");
        check(fixture.editorSessions.get() == 0, "Query used editor session");
        if (timeout) check(error.get() != null && error.get().getMessage().contains("exceeded 1 seconds"), "Timeout was not reported");
        else check(error.get() == null, "Manual cancellation published an error");
    }

    private static void isolationFailure(boolean single) throws Exception {
        Fixture fixture = new Fixture(single, !single);
        AtomicReference<Exception> error = new AtomicReference<>();
        DashboardQueryJob job = fixture.job(30, new AtomicInteger(), error);
        job.schedule();
        check(job.join(5000, null), "Isolation rejection did not finish");
        check(error.get() != null, "Unsupported isolation must fail visibly");
        check(fixture.started.getCount() == 1 && fixture.sharedClosed.get() == 0 && fixture.editorSessions.get() == 0,
            "Unsupported isolation used or closed editor context");
    }

    private static void concurrency() throws Exception {
        Fixture[] fixtures = new Fixture[6];
        DashboardQueryJob[] jobs = new DashboardQueryJob[6];
        try {
            for (int i = 0; i < jobs.length; i++) {
                fixtures[i] = new Fixture(false, false);
                jobs[i] = fixtures[i].job(30, new AtomicInteger(), new AtomicReference<>());
                jobs[i].schedule();
            }
            for (int i = 0; i < 4; i++) check(fixtures[i].started.await(5, TimeUnit.SECONDS), "Four slots did not start");
            check(!fixtures[4].started.await(200, TimeUnit.MILLISECONDS) && fixtures[5].started.getCount() == 1,
                "More than four widget queries executed together");
            jobs[4].requestCancellation();
            jobs[0].requestCancellation();
            check(fixtures[5].started.await(5, TimeUnit.SECONDS), "Waiting job did not get released slot");
            check(fixtures[4].started.getCount() == 1, "Cancelled queued job executed SQL");
        } finally {
            for (DashboardQueryJob job : jobs) if (job != null) job.requestCancellation();
            for (DashboardQueryJob job : jobs) if (job != null) check(job.join(5000, null), "Query cleanup failed");
        }
    }

    private static final class Fixture {
        final CountDownLatch started = new CountDownLatch(1), cancelled = new CountDownLatch(1);
        final AtomicInteger timeout = new AtomicInteger(), closed = new AtomicInteger(), sharedClosed = new AtomicInteger(), editorSessions = new AtomicInteger();
        final DBCExecutionContext shared;
        Fixture(boolean single, boolean returnsShared) {
            DBCStatement statement = proxy(DBCStatement.class, (object, method, args) -> {
                switch (method.getName()) {
                    case "setStatementTimeout": timeout.set((int) args[0]); return null;
                    case "executeStatement":
                        started.countDown();
                        check(cancelled.await(8, TimeUnit.SECONDS), "Blocked query was never cancelled");
                        return false;
                    case "cancelBlock": cancelled.countDown(); return null;
                    default: return defaultValue(method.getReturnType());
                }
            });
            DBCSession session = proxy(DBCSession.class, (object, method, args) -> method.getName().equals("prepareStatement") ? statement : defaultValue(method.getReturnType()));
            DBPDataSourceContainer container = proxy(DBPDataSourceContainer.class, (object, method, args) -> method.getName().equals("isForceUseSingleConnection") ? single : defaultValue(method.getReturnType()));
            DBPDataSource dataSource = proxy(DBPDataSource.class, (object, method, args) -> method.getName().equals("getContainer") ? container : defaultValue(method.getReturnType()));
            DBCExecutionContext isolated = proxy(DBCExecutionContext.class, (object, method, args) -> {
                if (method.getName().equals("openSession")) return session;
                if (method.getName().equals("close")) closed.incrementAndGet();
                return defaultValue(method.getReturnType());
            });
            AtomicReference<DBCExecutionContext> source = new AtomicReference<>();
            DBSInstance owner = proxy(DBSInstance.class, (object, method, args) -> {
                if (method.getName().equals("openIsolatedContext")) {
                    check(args[2] == source.get(), "Isolation must inherit the selected source context");
                    return returnsShared ? source.get() : isolated;
                }
                return defaultValue(method.getReturnType());
            });
            shared = proxy(DBCExecutionContext.class, (object, method, args) -> {
                switch (method.getName()) {
                    case "isConnected": return true;
                    case "getDataSource": return dataSource;
                    case "getOwnerInstance": return owner;
                    case "close": sharedClosed.incrementAndGet(); return null;
                    case "openSession": editorSessions.incrementAndGet(); throw new AssertionError("Editor session opened");
                    default: return defaultValue(method.getReturnType());
                }
            });
            source.set(shared);
        }
        DashboardQueryJob job(int seconds, AtomicInteger successes, AtomicReference<Exception> error) {
            return new DashboardQueryJob(() -> shared, "SELECT 1", 100, 1000, seconds, ignored -> successes.incrementAndGet(), error::set);
        }
    }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[] {type}, handler);
    }
    private static Object defaultValue(Class<?> type) {
        if (type == boolean.class) return false;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        return null;
    }
    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
