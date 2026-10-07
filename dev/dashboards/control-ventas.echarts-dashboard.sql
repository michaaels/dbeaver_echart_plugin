-- ECharts dashboard: Control de ventas y mapa de ciudades
-- Generated from JSON. Edit widget queries in the dashboard Source editor.

-- Widget: Ventas y costos diarios [ventas-diarias-linea]
-- Connection: General / test_hop_mcp
SELECT fecha, ROUND(SUM(ventas),2) AS ventas, ROUND(SUM(costos),2) AS costos
FROM echarts_test_sales
GROUP BY fecha ORDER BY fecha;

-- Widget: Comparación diaria [ventas-diarias-barras]
-- Connection: General / test_hop_mcp
SELECT fecha, ROUND(SUM(ventas),2) AS ventas, ROUND(SUM(costos),2) AS costos
FROM echarts_test_sales
GROUP BY fecha ORDER BY fecha;

-- Widget: Ventas por ciudad [ventas-ciudades-mapa]
-- Connection: General / test_hop_mcp
SELECT ciudad, longitud, latitud, ROUND(SUM(ventas),2) AS ventas
FROM echarts_test_sales
GROUP BY ciudad, longitud, latitud ORDER BY ventas DESC;
