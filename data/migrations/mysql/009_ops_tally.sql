-- Tally Bridge auto-output archive (15-Sep-2026): Busy Drive folder se "List of Supply Outward
-- Vouchers" khud process hokar yahan date+kind (2W/4W) wise save hota hai (busy-drive.js).
-- Har din ka naya sync usi din ki row replace karta hai (as_on+kind par UNIQUE) — taaki purane
-- dinon ka InvoiceTally bhi baad me date select karke dubara download ho sake.

CREATE TABLE IF NOT EXISTS ops_tally_output (
  id int NOT NULL AUTO_INCREMENT,
  as_on varchar(10) NOT NULL DEFAULT '',
  kind varchar(4) NOT NULL DEFAULT '',
  label varchar(60) NOT NULL DEFAULT '',
  file_name varchar(200) NOT NULL DEFAULT '',
  code varchar(40) NOT NULL DEFAULT '',
  matched_count int NOT NULL DEFAULT 0,
  dropped_count int NOT NULL DEFAULT 0,
  totals_json longtext,
  preview_json longtext,
  dropped_json longtext,
  xlsx_base64 longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ops_tally_output_uq (as_on, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
