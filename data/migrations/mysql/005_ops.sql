-- MICHELIN OPS (Bansal Oil Distributors) — DSR order app + live stock +
-- delivery tracking. Google Sheet "MICHELIN OPS" + Apps Script se yahan
-- utara gaya; sheet ke har tab ke badle ek ops_* table.
--
-- Har statement CREATE TABLE IF NOT EXISTS hai — ensure-schema.js ise HAR boot
-- par chalata hai, isliye purane database par bhi tables khud ban jaati hain.

-- USERS tab: mobile se login (password nahi — sheet wale system jaisa)
CREATE TABLE IF NOT EXISTS ops_users (
  id int NOT NULL AUTO_INCREMENT,
  mobile varchar(10) NOT NULL,
  name varchar(100) NOT NULL,
  role varchar(20) NOT NULL DEFAULT 'DSR',
  active tinyint NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ops_users_mobile_uq (mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ITEM_MASTER tab. price = App rate (0 matlab negotiated: order lete waqt rate type hota hai)
CREATE TABLE IF NOT EXISTS ops_items (
  id int NOT NULL AUTO_INCREMENT,
  code varchar(20) NOT NULL,
  brand varchar(50) NOT NULL DEFAULT '',
  segment varchar(10) NOT NULL DEFAULT '',
  category varchar(50) NOT NULL DEFAULT '',
  size varchar(50) NOT NULL DEFAULT '',
  position varchar(10) NOT NULL DEFAULT '',
  pattern varchar(80) NOT NULL DEFAULT '',
  tltt varchar(10) NOT NULL DEFAULT '',
  li varchar(20) NOT NULL DEFAULT '',
  basic_price decimal(12,2) NOT NULL DEFAULT 0,
  price decimal(12,2) NOT NULL DEFAULT 0,
  tube_price decimal(12,2) NOT NULL DEFAULT 0,
  stock int NOT NULL DEFAULT 0,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  busy_name varchar(200) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY ops_items_code_uq (code),
  KEY ops_items_busy_idx (busy_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- DEALERS tab (KYC files alag table me — Drive folder ki jagah DB blob)
CREATE TABLE IF NOT EXISTS ops_dealers (
  id int NOT NULL AUTO_INCREMENT,
  did varchar(10) NOT NULL,
  name varchar(150) NOT NULL,
  mobile varchar(10) NOT NULL DEFAULT '',
  city varchar(100) NOT NULL DEFAULT '',
  address varchar(500) NOT NULL DEFAULT '',
  added_by varchar(100) NOT NULL DEFAULT '',
  active tinyint NOT NULL DEFAULT 1,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  busy_name varchar(200) NOT NULL DEFAULT '',
  gst_no varchar(20) NOT NULL DEFAULT '',
  pan varchar(15) NOT NULL DEFAULT '',
  kyc_folder varchar(300) NOT NULL DEFAULT '',
  kyc_status varchar(20) NOT NULL DEFAULT '',
  lat varchar(30) NOT NULL DEFAULT '',
  lng varchar(30) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY ops_dealers_did_uq (did),
  KEY ops_dealers_mobile_idx (mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- KYC documents: gst / pan / aadhaar / cheque — ek dealer ki ek hi file per type
CREATE TABLE IF NOT EXISTS ops_dealer_docs (
  id int NOT NULL AUTO_INCREMENT,
  dealer_id int NOT NULL,
  doc_key varchar(10) NOT NULL,
  file_name varchar(200) NOT NULL DEFAULT '',
  mime varchar(60) NOT NULL DEFAULT 'image/jpeg',
  data longblob,
  drive_url varchar(300) NOT NULL DEFAULT '',
  uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ops_dealer_docs_uq (dealer_id, doc_key),
  CONSTRAINT ops_dealer_docs_dealer_fk FOREIGN KEY (dealer_id) REFERENCES ops_dealers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ORDERS tab. Items aur history sheet ki tarah JSON me hi hain — UI unhe
-- waise hi padhta hai, aur line items par koi alag query nahi chalti.
CREATE TABLE IF NOT EXISTS ops_orders (
  id int NOT NULL AUTO_INCREMENT,
  oid varchar(24) NOT NULL,
  order_date date NOT NULL,
  dsr_name varchar(100) NOT NULL DEFAULT '',
  dsr_mobile varchar(10) NOT NULL DEFAULT '',
  did varchar(10) NOT NULL DEFAULT '',
  dealer_name varchar(150) NOT NULL DEFAULT '',
  dealer_mobile varchar(10) NOT NULL DEFAULT '',
  city varchar(100) NOT NULL DEFAULT '',
  items_json longtext,
  total_qty int NOT NULL DEFAULT 0,
  amount decimal(12,2) NOT NULL DEFAULT 0,
  status varchar(12) NOT NULL DEFAULT 'PENDING',
  invoice_no varchar(50) NOT NULL DEFAULT '',
  vehicle varchar(100) NOT NULL DEFAULT '',
  note varchar(500) NOT NULL DEFAULT '',
  payment_terms varchar(200) NOT NULL DEFAULT '',
  history_json longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ops_orders_oid_uq (oid),
  KEY ops_orders_status_idx (status),
  KEY ops_orders_did_date_idx (did, order_date),
  KEY ops_orders_dsr_idx (dsr_mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- STOCK_LOG tab. type: OPENING / IN / OUT / EDIT / BUSY
CREATE TABLE IF NOT EXISTS ops_stock_log (
  id int NOT NULL AUTO_INCREMENT,
  log_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type varchar(10) NOT NULL,
  code varchar(20) NOT NULL,
  item_name varchar(200) NOT NULL DEFAULT '',
  qty int NOT NULL DEFAULT 0,
  prev_stock int NOT NULL DEFAULT 0,
  after_stock int NOT NULL DEFAULT 0,
  note varchar(300) NOT NULL DEFAULT '',
  by_name varchar(100) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY ops_stock_log_code_idx (code),
  KEY ops_stock_log_time_idx (log_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- OUTSTANDING tab: Busy "Amount Receivable" import ka snapshot (har import par replace)
CREATE TABLE IF NOT EXISTS ops_outstanding (
  id int NOT NULL AUTO_INCREMENT,
  dealer_name varchar(200) NOT NULL,
  mobile varchar(10) NOT NULL DEFAULT '',
  amount decimal(14,2) NOT NULL DEFAULT 0,
  as_on varchar(20) NOT NULL DEFAULT '',
  source varchar(20) NOT NULL DEFAULT 'Busy',
  PRIMARY KEY (id),
  KEY ops_outstanding_name_idx (dealer_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- PAYMENT_LOG tab: outstanding kam hua = payment aayi (approx, dealer-level)
CREATE TABLE IF NOT EXISTS ops_payment_log (
  id int NOT NULL AUTO_INCREMENT,
  log_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dealer_name varchar(200) NOT NULL,
  dealer_mobile varchar(10) NOT NULL DEFAULT '',
  amount_paid decimal(14,2) NOT NULL DEFAULT 0,
  old_outstanding decimal(14,2) NOT NULL DEFAULT 0,
  new_outstanding decimal(14,2) NOT NULL DEFAULT 0,
  as_on varchar(20) NOT NULL DEFAULT '',
  notified char(1) NOT NULL DEFAULT 'N',
  PRIMARY KEY (id),
  KEY ops_payment_log_notified_idx (notified)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- NOTIF_LOG tab: WhatsApp dedupe — key = event|orderId|number; status SENT ya "FAIL:... #3"
CREATE TABLE IF NOT EXISTS ops_notif_log (
  id int NOT NULL AUTO_INCREMENT,
  notif_key varchar(120) NOT NULL,
  event varchar(30) NOT NULL,
  oid varchar(24) NOT NULL DEFAULT '',
  to_number varchar(15) NOT NULL DEFAULT '',
  status varchar(120) NOT NULL DEFAULT '',
  log_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ops_notif_log_key_uq (notif_key),
  KEY ops_notif_log_oid_idx (oid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- IMPORT_LOG tab
CREATE TABLE IF NOT EXISTS ops_import_log (
  id int NOT NULL AUTO_INCREMENT,
  log_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  file_name varchar(200) NOT NULL DEFAULT '',
  result varchar(300) NOT NULL DEFAULT '',
  notes longtext,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- RM_LIST tab: Michelin / VK ke RM jinko Sale / Reorder report WhatsApp hoti hai
CREATE TABLE IF NOT EXISTS ops_rm_list (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(100) NOT NULL,
  mobile varchar(10) NOT NULL,
  company varchar(50) NOT NULL DEFAULT '',
  role varchar(50) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY ops_rm_list_mobile_uq (mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
