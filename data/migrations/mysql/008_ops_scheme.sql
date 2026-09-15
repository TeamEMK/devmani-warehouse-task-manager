-- Scheme Report (15-Sep-2026): Michelin/VK scheme catalog, Busy Drive folder se automatic
-- (jaise Stock/Outstanding/Tally Bridge — ".xlsx me 'Scheme' naam ka file daal do, app khud
-- parse + save karta hai). Har import ek "as on" date ka poora snapshot deta hai (as-on file
-- me na mile to import ki date); purani dates history me rehti hain taaki kisi bhi tareekh ka
-- catalog category-wise dekha ja sake. Har boot par chalta hai (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS ops_scheme_catalog (
  id int NOT NULL AUTO_INCREMENT,
  as_on varchar(10) NOT NULL DEFAULT '',
  category varchar(120) NOT NULL DEFAULT '',
  row_label varchar(300) NOT NULL DEFAULT '',
  data longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ops_scheme_catalog_idx (as_on, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
