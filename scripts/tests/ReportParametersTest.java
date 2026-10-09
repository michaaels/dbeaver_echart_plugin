package org.example.dbeaver.echarts;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.lang.reflect.Proxy;
import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;

/** Values are bound through JDBC setters; quoting never becomes SQL interpolation. */
public final class ReportParametersTest {
    public static void main(String[] args) throws Exception {
        JsonObject values = JsonParser.parseString("{\"name\":{\"type\":\"text\",\"value\":\"x'); DROP TABLE sales; --\"},\"amount\":{\"type\":\"number\",\"value\":\"12.50\"},\"date\":{\"type\":\"date\",\"value\":\"2026-10-01\"},\"enabled\":{\"type\":\"boolean\",\"value\":\"true\"}}").getAsJsonObject();
        String sql = "SELECT :name, :amount, :date, :enabled, :name, ':name', \"colon:date\", `:amount`, [:enabled], $$:name$$, $tag$:date$tag$, total::numeric -- :name\n/* :date */";
        var plan = ReportParameters.prepare(sql, values);
        check(plan.bindings().size() == 5, "Quoted/commented named values were bound");
        check(plan.sql().startsWith("SELECT ?, ?, ?, ?, ?, ':name'"), "SQL placeholders incorrect");
        check(plan.sql().contains("total::numeric") && !plan.sql().contains("DROP TABLE"), "SQL cast or injection handling");
        List<String> setters = new ArrayList<>(); List<Object> bound = new ArrayList<>();
        PreparedStatement statement = (PreparedStatement) Proxy.newProxyInstance(ReportParametersTest.class.getClassLoader(), new Class<?>[] { PreparedStatement.class }, (object, method, arguments) -> {
            if (method.getName().startsWith("set")) { setters.add(method.getName()); bound.add(arguments[1]); check((int) arguments[0] == bound.size(), "JDBC index"); return null; }
            throw new AssertionError("Unexpected JDBC operation: " + method.getName());
        });
        for (int i = 0; i < plan.bindings().size(); i++) plan.bindings().get(i).bind(statement, i + 1);
        check(setters.equals(List.of("setString", "setBigDecimal", "setDate", "setBoolean", "setString")), "Typed JDBC setter selection");
        check(bound.get(0).equals("x'); DROP TABLE sales; --") && bound.get(1).equals(new BigDecimal("12.50")), "Bound data changed");
        check(bound.get(2).toString().equals("2026-10-01") && bound.get(3).equals(true), "Date/boolean binding");
        // Exercise the exact DBeaver job adapter, not only the binding utility.
        setters.clear(); bound.clear();
        var bounded = (PreparedStatement) Proxy.newProxyInstance(ReportParametersTest.class.getClassLoader(),
            new Class<?>[] { PreparedStatement.class, org.jkiss.dbeaver.model.exec.DBCStatement.class }, (object, method, arguments) -> {
                if (method.getName().startsWith("set")) { setters.add(method.getName()); bound.add(arguments[1]); return null; }
                if (method.getName().equals("close")) return null;
                throw new AssertionError("Unexpected statement operation: " + method.getName());
            });
        var session = (org.jkiss.dbeaver.model.exec.DBCSession) Proxy.newProxyInstance(ReportParametersTest.class.getClassLoader(),
            new Class<?>[] { org.jkiss.dbeaver.model.exec.DBCSession.class, java.sql.Connection.class }, (object, method, arguments) -> {
                if (method.getName().equals("prepareStatement")) { check(arguments.length == 1 && arguments[0].equals(plan.sql()), "Typed SQL bypassed JDBC prepare"); return bounded; }
                throw new AssertionError("Unexpected session operation: " + method.getName());
            });
        var job = new DashboardQueryJob(() -> null, plan.sql(), 100, 1000, 30, ignored -> {}, ignored -> {}, plan.bindings());
        var prepare = DashboardQueryJob.class.getDeclaredMethod("prepare", org.jkiss.dbeaver.model.exec.DBCSession.class); prepare.setAccessible(true);
        check(prepare.invoke(job, session) == bounded && bound.size() == 5, "Job did not bind and retain DBC limits/cancellation adapter");
        for (String invalid : List.of("SELECT :missing", "SELECT ?", "SELECT 'unclosed", "SELECT 'back\\slash'", "SELECT /* unclosed", "SELECT $tag$unclosed")) fail(() -> ReportParameters.prepare(invalid, values));
        values.getAsJsonObject("date").addProperty("value", "2026-02-30"); fail(() -> ReportParameters.prepare("SELECT :date", values)); values.getAsJsonObject("date").addProperty("value", "2026-10-01");
        values.getAsJsonObject("amount").addProperty("value", "NaN"); fail(() -> ReportParameters.prepare("SELECT :amount", values)); values.getAsJsonObject("amount").addProperty("value", "12.50");
        values.getAsJsonObject("enabled").addProperty("value", "yes"); fail(() -> ReportParameters.prepare("SELECT :enabled", values)); values.getAsJsonObject("enabled").addProperty("value", "true");
        DashboardQueryApproval approval = new DashboardQueryApproval();
        JsonObject source = JsonParser.parseString("{\"kind\":\"savedQuery\",\"connectionId\":\"local\",\"maxRows\":100}").getAsJsonObject(); source.add("parameters", values);
        check(approval.approve("[{\"id\":\"report\",\"sql\":\"SELECT :date\",\"source\":" + source + "}]"), "Report SQL approval");
        check(approval.accepts("report", "SELECT :date", source), "Approved query rejected");
        values.getAsJsonObject("date").addProperty("value", "2026-10-02"); check(!approval.accepts("report", "SELECT :date", source), "Changed parameter retained approval"); values.getAsJsonObject("date").addProperty("value", "2026-10-01");
        source.addProperty("maxRows", 200); check(!approval.accepts("report", "SELECT :date", source), "Changed row limit retained approval");
        System.out.println("Report parameters OK: lexical placeholders, quoted SQL/casts/comments, typed JDBC bindings, injection-safe values, strict validation and approval binding");
    }
    private interface Action { void run(); }
    private static void fail(Action action) { try { action.run(); } catch (RuntimeException expected) { return; } throw new AssertionError("Expected rejection"); }
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
}
