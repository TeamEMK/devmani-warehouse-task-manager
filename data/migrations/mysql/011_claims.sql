-- Claim Management System (18-Sep-2026) — port from Google Apps Script/Sheets
-- (Devmani WMS "Claim" module: Claim Entry, Claim Dashboard, ACK Tracking,
-- Claim Receiving Upload/Pending) into MySQL. Old Apps Script system keeps
-- running in parallel until this is fully verified — see docs discussion.

-- Ek row per claim (purane system me status badalte hi row doosri sheet me
-- move ho jaati thi aur beech ki history kho jaati thi — ab sirf status
-- column badalta hai, row wahi rehta hai; history claim_status_log me).
CREATE TABLE IF NOT EXISTS claims (
  id int NOT NULL AUTO_INCREMENT,
  claim_no varchar(40) DEFAULT NULL,
  entry_type varchar(20) NOT NULL,
  dealer_name varchar(150) NOT NULL DEFAULT '',
  material varchar(200) NOT NULL DEFAULT '',
  stencil_no varchar(60) NOT NULL DEFAULT '',
  mould_no varchar(60) NOT NULL DEFAULT '',
  status varchar(30) NOT NULL,
  remark text,
  receiving text,
  received_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY claims_claim_no_uq (claim_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Status transition audit trail — purane system me ye nahi tha (row move
-- hote hi purani jagah ka waqt kho jaata tha).
CREATE TABLE IF NOT EXISTS claim_status_log (
  id int NOT NULL AUTO_INCREMENT,
  claim_id int NOT NULL,
  from_status varchar(30) NOT NULL DEFAULT '',
  to_status varchar(30) NOT NULL DEFAULT '',
  note varchar(300) NOT NULL DEFAULT '',
  changed_by int DEFAULT NULL,
  changed_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY claim_status_log_claim_idx (claim_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Dealer dropdown (Claim Entry) — seed-claims.sql se ~43 dealers bharega,
-- admin baad me POST /api/claims/dealers se aur jod sakta hai.
CREATE TABLE IF NOT EXISTS claim_dealers (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(150) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY claim_dealers_name_uq (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- "Sheet4" ka jagah — Claim Entry ke "Auto-Find" ke liye master reference
-- (manufacturer/Michelin se milta hai), admin .xlsx upload se poora replace.
CREATE TABLE IF NOT EXISTS claim_master_ref (
  claim_no varchar(40) NOT NULL,
  dealer_name varchar(150) NOT NULL DEFAULT '',
  material varchar(200) NOT NULL DEFAULT '',
  stencil_no varchar(60) NOT NULL DEFAULT '',
  mould_no varchar(60) NOT NULL DEFAULT '',
  uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (claim_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ACK Tracking sheet ka jagah — admin .xlsx upload se poora replace (jaise
-- Scheme Catalog).
CREATE TABLE IF NOT EXISTS claim_ack (
  id int NOT NULL AUTO_INCREMENT,
  claim_no varchar(40) NOT NULL DEFAULT '',
  dealer_name varchar(150) NOT NULL DEFAULT '',
  item_desc varchar(200) NOT NULL DEFAULT '',
  stencil_no varchar(60) NOT NULL DEFAULT '',
  claim_date date DEFAULT NULL,
  status varchar(60) NOT NULL DEFAULT '',
  uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY claim_ack_dealer_idx (dealer_name),
  KEY claim_ack_date_idx (claim_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
