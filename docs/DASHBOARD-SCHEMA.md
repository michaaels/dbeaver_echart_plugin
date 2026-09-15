# Dashboard JSON schema

Dashboard files use the suffix `.echarts-dashboard.json` and are UTF-8 JSON documents.

```json
{
  "schemaVersion": 1,
  "title": "Result dashboard",
  "variables": { "region": "west" },
  "filters": { "region": "west" },
  "widgets": [
    {
      "id": "widget-1",
      "title": "Traffic",
      "source": {
        "schemaVersion": 1,
        "kind": "savedQuery",
        "connection": "local",
        "sql": "select event_time, traffic from metrics"
      },
      "chart": {
        "chartType": "line",
        "xColumn": "event_time",
        "yColumns": ["traffic"],
        "yAxes": { "traffic": "left" },
        "marks": { "markLine": true }
      },
      "refreshPolicy": { "mode": "interval", "intervalSeconds": 60 },
      "drillDown": { "enabled": true },
      "layout": { "columnSpan": 1, "rowSpan": 1 }
    }
  ]
}
```

Imported documents are normalized before use. At most 24 widgets and 50 shared
variables/filters are accepted. Widget SQL is limited to one read-only query and
is executed through the active DBeaver execution context with the configured row
and cell limits.
