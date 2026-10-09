-- ECharts report: Reporte diario de ventas
-- Generated from the report JSON.

-- Query: Ventas diarias
SELECT fecha, ROUND(SUM(ventas),2) AS ventas, ROUND(SUM(costos),2) AS costos
FROM echarts_test_sales
WHERE fecha >= :start_date
GROUP BY fecha ORDER BY fecha;
