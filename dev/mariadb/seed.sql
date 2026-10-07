-- Synthetic fixtures for MariaDB. Safe to rerun: stable keys and INSERT IGNORE.
CREATE TABLE IF NOT EXISTS echarts_test_sales (
  id INT PRIMARY KEY,
  fecha DATE NOT NULL,
  region VARCHAR(30) NOT NULL,
  ciudad VARCHAR(40) NOT NULL,
  producto VARCHAR(40) NOT NULL,
  canal VARCHAR(20) NOT NULL,
  unidades INT NOT NULL,
  ventas DECIMAL(12,2) NOT NULL,
  costos DECIMAL(12,2) NOT NULL,
  satisfaccion DECIMAL(5,2) NULL,
  longitud DECIMAL(9,5) NOT NULL,
  latitud DECIMAL(9,5) NOT NULL,
  INDEX idx_echarts_fecha (fecha)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO echarts_test_sales
WITH RECURSIVE dias AS (
  SELECT 0 AS n UNION ALL SELECT n+1 FROM dias WHERE n<89
), ciudades AS (
  SELECT 0 AS n, 'Costa' AS region, 'Guayaquil' AS ciudad, -79.8891 AS lon, -2.1894 AS lat
  UNION ALL SELECT 1, 'Sierra', 'Quito', -78.4678, -0.1807
  UNION ALL SELECT 2, 'Sierra', 'Cuenca', -79.0059, -2.9001
  UNION ALL SELECT 3, 'Amazonía', 'Tena', -77.8129, -0.9938
  UNION ALL SELECT 4, 'Costa', 'Manta', -80.7089, -0.9677
  UNION ALL SELECT 5, 'Insular', 'Puerto Ayora', -90.3137, -0.7433
), productos AS (
  SELECT 0 AS n, 'Café' AS nombre UNION ALL SELECT 1, 'Cacao' UNION ALL SELECT 2, 'Artesanías'
), canales AS (
  SELECT 0 AS n, 'Tienda' AS nombre UNION ALL SELECT 1, 'Web'
)
SELECT 1 + d.n*36 + c.n*6 + p.n*2 + ca.n,
       DATE_ADD('2026-07-01', INTERVAL d.n DAY), c.region, c.ciudad, p.nombre, ca.nombre,
       8 + MOD(d.n*7 + c.n*11 + p.n*5 + ca.n*3, 40),
       ROUND((8 + MOD(d.n*7 + c.n*11 + p.n*5 + ca.n*3, 40)) * (12 + p.n*7)
             * (1 + d.n/180) * (1 + ca.n*0.15), 2),
       ROUND((8 + MOD(d.n*7 + c.n*11 + p.n*5 + ca.n*3, 40)) * (7 + p.n*4), 2),
       CASE WHEN MOD(d.n+c.n+p.n,19)=0 THEN NULL ELSE 65 + MOD(d.n+c.n*7+p.n*11,35) END,
       c.lon, c.lat
FROM dias d CROSS JOIN ciudades c CROSS JOIN productos p CROSS JOIN canales ca;

CREATE TABLE IF NOT EXISTS echarts_test_funnel (
  etapa INT PRIMARY KEY, nombre VARCHAR(40) NOT NULL, cantidad INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO echarts_test_funnel VALUES
  (1,'Visitas',10000),(2,'Interés',6800),(3,'Carrito',3500),(4,'Pago',2100),(5,'Compra',1800);

CREATE TABLE IF NOT EXISTS echarts_test_edge_cases (
  id INT PRIMARY KEY, categoria VARCHAR(120) NOT NULL,
  valor DECIMAL(16,2) NULL, segunda_serie DECIMAL(16,2) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO echarts_test_edge_cases VALUES
  (1,'Positivo',120.50,80),(2,'Cero',0,0),(3,'Negativo',-45.25,20),
  (4,'Nulo',NULL,60),(5,'Ñ, tildes: café y Amazonía',90,110),
  (6,'Etiqueta larga para probar el ajuste del texto y la leyenda',55.75,NULL),
  (7,'Valor grande',1000000.25,999999.75);
