-- MICHELIN OPS v2 — naye tables: order files (invoice/POD), DSR attendance,
-- expenses, route plans. ops_orders ke naye columns ensure-schema.js JS se
-- jodta hai (MySQL me ADD COLUMN IF NOT EXISTS nahi hota).
-- Har statement CREATE TABLE IF NOT EXISTS — har boot par safe.

-- Order ke saath lagi files: Busy invoice (PDF/photo), POD (delivery proof)
CREATE TABLE IF NOT EXISTS ops_order_files (
  id int NOT NULL AUTO_INCREMENT,
  oid varchar(24) NOT NULL,
  kind varchar(10) NOT NULL,
  file_name varchar(200) NOT NULL DEFAULT '',
  mime varchar(60) NOT NULL DEFAULT 'image/jpeg',
  data longblob,
  drive_url varchar(300) NOT NULL DEFAULT '',
  uploaded_by varchar(100) NOT NULL DEFAULT '',
  uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ops_order_files_uq (oid, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- DSR attendance: din shuru (GPS + aaj ka plan) aur din khatam
CREATE TABLE IF NOT EXISTS ops_attendance (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  att_date date NOT NULL,
  start_at datetime DEFAULT NULL,
  start_lat varchar(30) NOT NULL DEFAULT '',
  start_lng varchar(30) NOT NULL DEFAULT '',
  end_at datetime DEFAULT NULL,
  end_lat varchar(30) NOT NULL DEFAULT '',
  end_lng varchar(30) NOT NULL DEFAULT '',
  plan longtext,
  remark varchar(500) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY ops_attendance_uq (user_id, att_date),
  KEY ops_attendance_date_idx (att_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- DSR expenses: fuel / food / travel / other; admin approve/reject
CREATE TABLE IF NOT EXISTS ops_expenses (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  exp_date date NOT NULL,
  type varchar(20) NOT NULL DEFAULT 'other',
  amount decimal(12,2) NOT NULL DEFAULT 0,
  note varchar(300) NOT NULL DEFAULT '',
  receipt_name varchar(200) NOT NULL DEFAULT '',
  receipt_mime varchar(60) NOT NULL DEFAULT '',
  receipt longblob,
  receipt_drive_url varchar(300) NOT NULL DEFAULT '',
  status varchar(10) NOT NULL DEFAULT 'PENDING',
  decided_by varchar(100) NOT NULL DEFAULT '',
  decided_at datetime DEFAULT NULL,
  decision_note varchar(300) NOT NULL DEFAULT '',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ops_expenses_user_date_idx (user_id, exp_date),
  KEY ops_expenses_status_idx (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Route plan: ek DSR ka ek din ka plan; stops JSON me
-- [{did,name,city,status:PLANNED|VISITED|SKIPPED,visited_at,lat,lng,note}]
CREATE TABLE IF NOT EXISTS ops_route_plans (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  plan_date date NOT NULL,
  stops_json longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ops_route_plans_uq (user_id, plan_date),
  KEY ops_route_plans_date_idx (plan_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
