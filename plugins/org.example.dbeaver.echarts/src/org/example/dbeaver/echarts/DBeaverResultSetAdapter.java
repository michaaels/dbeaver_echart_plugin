package org.example.dbeaver.echarts;

import org.eclipse.swt.dnd.HTMLTransfer;
import org.eclipse.swt.dnd.TextTransfer;
import org.eclipse.swt.dnd.Transfer;
import org.jkiss.dbeaver.model.data.DBDAttributeBinding;
import org.jkiss.dbeaver.model.sql.SQLQueryContainer;
import org.jkiss.dbeaver.model.sql.SQLScriptElement;
import org.jkiss.dbeaver.model.struct.DBSDataContainer;
import org.jkiss.dbeaver.ui.controls.resultset.IResultSetController;
import org.jkiss.dbeaver.ui.controls.resultset.ResultSetCopySettings;
import org.jkiss.dbeaver.ui.controls.resultset.ResultSetModel;
import org.jkiss.dbeaver.ui.controls.resultset.ResultSetRow;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.temporal.TemporalAccessor;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The only class that translates DBeaver's result-set model to our browser DTO.
 * Keeping this dependency boundary small makes DBeaver upgrades easier to absorb.
 */
final class DBeaverResultSetAdapter {
    static final int DEFAULT_MAX_ROWS = 50_000;
    static final int DEFAULT_MAX_CELLS = 1_000_000;
    private static final long JS_MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final BigInteger JS_MAX_SAFE_BIG_INTEGER = BigInteger.valueOf(JS_MAX_SAFE_INTEGER);
    private static final BigInteger JS_MIN_SAFE_BIG_INTEGER = BigInteger.valueOf(-JS_MAX_SAFE_INTEGER);

    private final IResultSetController controller;
    private final int maxRows;
    private final int maxCells;

    DBeaverResultSetAdapter(IResultSetController controller) {
        this(controller, EChartsPreferences.getMaxRows(), EChartsPreferences.getMaxCells());
    }

    DBeaverResultSetAdapter(IResultSetController controller, int maxRows, int maxCells) {
        this.controller = controller;
        this.maxRows = Math.max(1, maxRows);
        this.maxCells = Math.max(1, maxCells);
    }

    String snapshotAsJson() {
        ResultSetModel model = controller.getModel();
        List<DBDAttributeBinding> attributes = model.getVisibleLeafAttributes();
        int rowCount = model.getRowCount();
        int columnCount = Math.max(1, attributes.size());
        int maxRowsByCellBudget = Math.max(1, maxCells / columnCount);
        int effectiveMaxRows = Math.min(maxRows, maxRowsByCellBudget);
        int exportedRowCount = Math.min(rowCount, effectiveMaxRows);

        List<Map<String, Object>> columns = new ArrayList<>(attributes.size());
        for (int i = 0; i < attributes.size(); i++) {
            DBDAttributeBinding attribute = attributes.get(i);
            Map<String, Object> column = new LinkedHashMap<>();
            column.put("index", i);
            column.put("name", attribute.getName());
            column.put("kind", attribute.getDataKind().name());
            columns.add(column);
        }

        List<List<Object>> rows = new ArrayList<>(exportedRowCount);
        for (int rowIndex = 0; rowIndex < exportedRowCount; rowIndex++) {
            ResultSetRow row = model.getRow(rowIndex);
            List<Object> values = new ArrayList<>(attributes.size());
            for (DBDAttributeBinding attribute : attributes) {
                Object value = model.getCellValue(attribute, row);
                values.add(normalize(value));
            }
            rows.add(values);
        }

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("schemaVersion", 1);
        snapshot.put("columns", columns);
        snapshot.put("rows", rows);
        snapshot.put("rowCount", rowCount);
        snapshot.put("exportedRowCount", exportedRowCount);
        snapshot.put("truncated", exportedRowCount < rowCount);
        snapshot.put("maxRows", maxRows);
        snapshot.put("maxCells", maxCells);
        snapshot.put("effectiveMaxRows", effectiveMaxRows);
        snapshot.put("defaultRenderer", EChartsPreferences.getDefaultRenderer());
        snapshot.put("source", sourceDescriptor());
        return JsonWriter.write(snapshot);
    }

    private Map<String, Object> sourceDescriptor() {
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("schemaVersion", 1);
        source.put("kind", "activeResultSet");

        DBSDataContainer dataContainer = controller.getDataContainer();
        if (dataContainer != null) {
            source.put("name", dataContainer.getName());
        }
        if (controller.getContainer() instanceof SQLQueryContainer queryContainer) {
            SQLScriptElement query = queryContainer.getQuery();
            if (query != null) {
                source.put("sql", query.getOriginalText());
            }
            if (queryContainer.getDataSourceContainer() != null) {
                source.put("connection", queryContainer.getDataSourceContainer().getName());
                source.put("connectionId", queryContainer.getDataSourceContainer().getId());
                source.put("project", queryContainer.getDataSourceContainer().getProject().getName());
            }
        }
        return source;
    }

    Map<Transfer, Object> copySelection(ResultSetCopySettings settings) {
        ResultSetModel model = controller.getModel();
        List<DBDAttributeBinding> attributes = model.getVisibleLeafAttributes();
        List<Integer> rowIndexes = selectedRowIndexes(model);
        String text = renderDelimited(model, attributes, rowIndexes, settings);

        Map<Transfer, Object> transfers = new LinkedHashMap<>();
        transfers.put(TextTransfer.getInstance(), text);
        if (settings.isCopyHTML()) {
            transfers.put(HTMLTransfer.getInstance(), renderHtml(model, attributes, rowIndexes, settings));
        }
        return transfers;
    }

    private List<Integer> selectedRowIndexes(ResultSetModel model) {
        int[] selectedRecords = controller.getSelectedRecords();
        List<Integer> indexes = new ArrayList<>();
        int columnCount = Math.max(1, model.getVisibleLeafAttributes().size());
        int copyRowLimit = Math.max(1, Math.min(maxRows, maxCells / columnCount));
        if (selectedRecords != null && selectedRecords.length > 0) {
            for (int index : selectedRecords) {
                if (index >= 0 && index < model.getRowCount() && indexes.size() < copyRowLimit) {
                    indexes.add(index);
                }
            }
            return indexes;
        }

        int rowCount = Math.min(model.getRowCount(), copyRowLimit);
        for (int index = 0; index < rowCount; index++) {
            indexes.add(index);
        }
        return indexes;
    }

    private String renderDelimited(
        ResultSetModel model,
        List<DBDAttributeBinding> attributes,
        List<Integer> rowIndexes,
        ResultSetCopySettings settings
    ) {
        String columnDelimiter = defaultValue(settings.getColumnDelimiter(), "\t");
        String rowDelimiter = defaultValue(settings.getRowDelimiter(), "\n");
        String quote = defaultValue(settings.getQuoteString(), "\"");
        StringBuilder output = new StringBuilder();

        if (settings.isCopyHeader()) {
            List<String> headers = new ArrayList<>();
            if (settings.isCopyRowNumbers()) {
                headers.add("#");
            }
            headers.addAll(attributes.stream().map(DBDAttributeBinding::getName).toList());
            appendDelimitedRow(output, headers,
                columnDelimiter, rowDelimiter, quote, settings);
        }
        for (int i = 0; i < rowIndexes.size(); i++) {
            int rowIndex = rowIndexes.get(i);
            ResultSetRow row = model.getRow(rowIndex);
            List<String> values = new ArrayList<>();
            if (settings.isCopyRowNumbers()) {
                values.add(String.valueOf(rowIndex + 1));
            }
            for (DBDAttributeBinding attribute : attributes) {
                values.add(displayValue(model.getCellValue(attribute, row)));
            }
            appendDelimitedRow(output, values, columnDelimiter, rowDelimiter, quote, settings);
        }
        return output.toString();
    }

    private void appendDelimitedRow(
        StringBuilder output,
        List<String> values,
        String columnDelimiter,
        String rowDelimiter,
        String quote,
        ResultSetCopySettings settings
    ) {
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                output.append(columnDelimiter);
            }
            String value = values.get(i);
            boolean quoteValue = settings.isForceQuotes()
                || settings.isQuoteCells()
                || value.contains(columnDelimiter)
                || value.contains(rowDelimiter)
                || value.contains(quote);
            if (quoteValue) {
                output.append(quote).append(value.replace(quote, quote + quote)).append(quote);
            } else {
                output.append(value);
            }
        }
        output.append(rowDelimiter);
    }

    private String renderHtml(
        ResultSetModel model,
        List<DBDAttributeBinding> attributes,
        List<Integer> rowIndexes,
        ResultSetCopySettings settings
    ) {
        StringBuilder output = new StringBuilder("<table><thead><tr>");
        if (settings.isCopyHeader()) {
            if (settings.isCopyRowNumbers()) {
                output.append("<th>#</th>");
            }
            for (DBDAttributeBinding attribute : attributes) {
                output.append("<th>").append(escapeHtml(attribute.getName())).append("</th>");
            }
        }
        output.append("</tr></thead><tbody>");
        for (int rowIndex : rowIndexes) {
            output.append("<tr>");
            if (settings.isCopyRowNumbers()) {
                output.append("<td>").append(rowIndex + 1).append("</td>");
            }
            ResultSetRow row = model.getRow(rowIndex);
            for (DBDAttributeBinding attribute : attributes) {
                output.append("<td>")
                    .append(escapeHtml(displayValue(model.getCellValue(attribute, row))))
                    .append("</td>");
            }
            output.append("</tr>");
        }
        return output.append("</tbody></table>").toString();
    }

    private static String displayValue(Object value) {
        return value == null ? "" : String.valueOf(normalize(value));
    }

    private static String escapeHtml(String value) {
        return value
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#39;");
    }

    private static String defaultValue(String value, String fallback) {
        return value == null || value.isEmpty() ? fallback : value;
    }

    static Object normalize(Object value) {
        if (value == null || value instanceof Boolean || value instanceof String) {
            return value;
        }
        if (value instanceof Character character) {
            return character.toString();
        }
        if (value instanceof Byte || value instanceof Short || value instanceof Integer) {
            return value;
        }
        if (value instanceof Long number) {
            long n = number.longValue();
            return n >= -JS_MAX_SAFE_INTEGER && n <= JS_MAX_SAFE_INTEGER ? number : number.toString();
        }
        if (value instanceof BigInteger number) {
            return number.compareTo(JS_MIN_SAFE_BIG_INTEGER) >= 0 && number.compareTo(JS_MAX_SAFE_BIG_INTEGER) <= 0
                ? number
                : number.toString();
        }
        if (value instanceof BigDecimal number) {
            // Preserve arbitrary precision. The UI converts to Number only when a chart requires it.
            return number.toPlainString();
        }
        if (value instanceof Double number) {
            return Double.isFinite(number) ? number : null;
        }
        if (value instanceof Float number) {
            return Float.isFinite(number) ? number : null;
        }
        if (value instanceof Number) {
            return value.toString();
        }
        if (value instanceof java.sql.Date date) {
            return date.toLocalDate().toString();
        }
        if (value instanceof java.sql.Time time) {
            return time.toLocalTime().toString();
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant().toString();
        }
        if (value instanceof Date date) {
            return date.toInstant().toString();
        }
        if (value instanceof TemporalAccessor temporal) {
            return temporal.toString();
        }
        if (value instanceof byte[] bytes) {
            return "[binary " + bytes.length + " bytes]";
        }
        return String.valueOf(value);
    }
}
