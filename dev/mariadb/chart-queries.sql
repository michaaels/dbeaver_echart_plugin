-- 01 Lines / bars / area: X=fecha, Y=ventas,costos.
SELECT fecha, ROUND(SUM(ventas),2) ventas, ROUND(SUM(costos),2) costos
FROM echarts_test_sales GROUP BY fecha ORDER BY fecha;

-- 02 Pie (donut) / treemap: X=region, Y=ventas.
SELECT region, ROUND(SUM(ventas),2) ventas, ROUND(SUM(costos),2) costos
FROM echarts_test_sales GROUP BY region ORDER BY ventas DESC;

-- 03 Scatter: X=unidades, Y=ventas (numeric X axis).
SELECT unidades, ventas, costos, ciudad, producto FROM echarts_test_sales ORDER BY id LIMIT 300;

-- 04 Volume / sampling: X=id, Y=ventas,costos. Fetch all 3240 rows in DBeaver.
SELECT id, ventas, costos FROM echarts_test_sales ORDER BY id;

-- 05 Boxplot: select ventas,costos,unidades as Y (one box per numeric series).
SELECT producto, ventas, costos, unidades FROM echarts_test_sales ORDER BY id;

-- 06 Heatmap: X=fecha, Y=costa,sierra,amazonia,insular.
SELECT fecha,
       ROUND(SUM(CASE WHEN region='Costa' THEN ventas ELSE 0 END),2) costa,
       ROUND(SUM(CASE WHEN region='Sierra' THEN ventas ELSE 0 END),2) sierra,
       ROUND(SUM(CASE WHEN region='Amazonía' THEN ventas ELSE 0 END),2) amazonia,
       ROUND(SUM(CASE WHEN region='Insular' THEN ventas ELSE 0 END),2) insular
FROM echarts_test_sales GROUP BY fecha ORDER BY fecha;

-- 07 Gauge: X=indicador, Y=valor (range is calculated by the plugin).
SELECT 'Satisfacción' indicador, ROUND(AVG(satisfaccion),2) valor FROM echarts_test_sales;

-- 08 Funnel: X=nombre, Y=cantidad.
SELECT nombre, cantidad FROM echarts_test_funnel ORDER BY etapa;

-- 09 Map: X=longitud, Y=latitud,ventas.
SELECT ciudad, longitud, latitud, ROUND(SUM(ventas),2) ventas
FROM echarts_test_sales GROUP BY ciudad, longitud, latitud ORDER BY ventas DESC;

-- 10 Nulls, zero, negative, Unicode, long labels, large values.
SELECT categoria, valor, segunda_serie FROM echarts_test_edge_cases ORDER BY id;

-- 11 Empty result.
SELECT categoria, valor FROM echarts_test_edge_cases WHERE 1=0;

-- 12 One row.
SELECT categoria, valor FROM echarts_test_edge_cases WHERE id=1;

-- 13 Dashboard SQL widget / KPI.
SELECT 'Ventas totales' indicador, ROUND(SUM(ventas),2) valor FROM echarts_test_sales;

-- 14 Dashboard SQL widget / top cities.
SELECT ciudad, ROUND(SUM(ventas),2) ventas FROM echarts_test_sales GROUP BY ciudad ORDER BY ventas DESC;

-- 15 Radar: select ventas,costos,unidades,satisfaccion as Y (one axis per metric).
SELECT ciudad, ROUND(AVG(ventas),2) ventas, ROUND(AVG(costos),2) costos,
       ROUND(AVG(unidades),2) unidades, ROUND(AVG(satisfaccion),2) satisfaccion
FROM echarts_test_sales GROUP BY ciudad ORDER BY ciudad;
