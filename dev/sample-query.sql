-- Run in SQLite (including DBeaver's SQLite sample database).
-- Select the ECharts presentation after executing this query.
WITH datos(fecha, region, ventas, costos, longitud, latitud) AS (
  VALUES
    ('2026-09-01', 'Costa', 1200, 700, -79.9, -2.2),
    ('2026-09-01', 'Sierra', 1600, 900, -78.5, -0.2),
    ('2026-09-02', 'Costa', 1400, 800, -79.9, -2.2),
    ('2026-09-02', 'Sierra', 1800, 950, -78.5, -0.2),
    ('2026-09-03', 'Costa', 1500, 850, -79.9, -2.2),
    ('2026-09-03', 'Sierra', 2100, 1100, -78.5, -0.2)
)
SELECT * FROM datos ORDER BY fecha, region;
