-- Scheme Catalog original file archive (16-Sep-2026): jis .xlsx se ops_scheme_catalog
-- ek "as on" date ke liye bhara tha, uski raw file bhi yahan rakhte hain (as_on par ek hi
-- row, upsert) — taaki "Send to client" button admin ka parsed/reformatted data nahi,
-- Michelin/VK ne jo asli file di thi wahi client ko WhatsApp par bhej sake.

CREATE TABLE IF NOT EXISTS ops_scheme_file (
  as_on varchar(10) NOT NULL,
  file_name varchar(200) NOT NULL DEFAULT '',
  xlsx_base64 longtext,
  uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (as_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
