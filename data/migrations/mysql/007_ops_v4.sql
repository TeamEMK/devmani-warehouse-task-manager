-- Michelin Ops v4 (14-Sep-2026): Busy ledger/party analysis, IMS daily snapshots
-- Har boot par chalta hai (CREATE TABLE IF NOT EXISTS). Columns ensure-schema.js jodta hai.

-- Busy backup se party ledger (Sundry Debtors ki har account line) — account statement ke liye.
-- Har backup import par poora replace (current FY).
CREATE TABLE IF NOT EXISTS ops_busy_ledger (
  id int NOT NULL AUTO_INCREMENT,
  party_name varchar(200) NOT NULL,
  vch_date date NOT NULL,
  vch_type int NOT NULL DEFAULT 0,
  vch_no varchar(60) NOT NULL DEFAULT '',
  series varchar(60) NOT NULL DEFAULT '',
  narration varchar(200) NOT NULL DEFAULT '',
  dr decimal(14,2) NOT NULL DEFAULT 0,
  cr decimal(14,2) NOT NULL DEFAULT 0,
  fy int NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ops_busy_ledger_party (party_name, vch_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Party-wise analysis: opening, Michelin/VK split (FIFO: bakaya latest bills par), due-from date
CREATE TABLE IF NOT EXISTS ops_busy_party (
  party_name varchar(200) NOT NULL,
  opening decimal(14,2) NOT NULL DEFAULT 0,
  balance decimal(14,2) NOT NULL DEFAULT 0,
  michelin_amt decimal(14,2) NOT NULL DEFAULT 0,
  vk_amt decimal(14,2) NOT NULL DEFAULT 0,
  other_amt decimal(14,2) NOT NULL DEFAULT 0,
  due_from date DEFAULT NULL,
  last_sale date DEFAULT NULL,
  last_receipt date DEFAULT NULL,
  fy int NOT NULL DEFAULT 0,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (party_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- IMS: item ka din-wise stock snapshot (har Busy import + raat ko cron)
CREATE TABLE IF NOT EXISTS ops_stock_daily (
  item_code varchar(20) NOT NULL,
  day date NOT NULL,
  stock int NOT NULL DEFAULT 0,
  PRIMARY KEY (item_code, day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
