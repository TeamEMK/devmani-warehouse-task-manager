-- MySQL 8 schema.
-- migrations/postgres/001_init.sql se generate kiya gaya. Farak sirf itna:
--   serial                    -> int AUTO_INCREMENT
--   timestamp                 -> datetime (MySQL timestamp 2038 par khatam hota hai)
--   DEFAULT NOW()             -> DEFAULT CURRENT_TIMESTAMP
--   updated_at trigger        -> ON UPDATE CURRENT_TIMESTAMP (column attribute)
--   enum se bani text columns -> varchar (MySQL TEXT par bina prefix index nahi lagta)
--   baaki text                -> longtext (MySQL ka text sirf 64KB)
--   bytea                     -> longblob
-- Dono file ek hi tarah ki tables banati hain; sirf ek chuni jaati hai.

CREATE TABLE app_settings (
  key_name varchar(100) NOT NULL,
  value longtext,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (key_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE app_state (
  k varchar(64) NOT NULL,
  v varchar(255) DEFAULT NULL,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE cc_cards (
  id int NOT NULL AUTO_INCREMENT,
  bank_name varchar(50) NOT NULL,
  card_number varchar(50) NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT cc_cards_uq_card_uq UNIQUE (bank_name,card_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE cc_departments (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(100) NOT NULL,
  sort_order int DEFAULT '0',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT cc_departments_name_uq UNIQUE (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE cc_statements (
  id int NOT NULL AUTO_INCREMENT,
  card_id int NOT NULL,
  statement_date date DEFAULT NULL,
  payment_due_date date DEFAULT NULL,
  payable_amount decimal(12,2) DEFAULT '0.00',
  min_amount_due decimal(12,2) DEFAULT '0.00',
  statement_period varchar(150) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pdf_data longblob,
  drive_file_id varchar(200) DEFAULT NULL,
  PRIMARY KEY (id),
  CONSTRAINT cc_statements_uq_stmt_uq UNIQUE (card_id,statement_date),
  CONSTRAINT cc_statements_cc_statements_ibfk_1 FOREIGN KEY (card_id) REFERENCES cc_cards (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE cc_transactions (
  id int NOT NULL AUTO_INCREMENT,
  statement_id int NOT NULL,
  txn_date date DEFAULT NULL,
  description varchar(500) DEFAULT NULL,
  amount decimal(12,2) DEFAULT '0.00',
  txn_type varchar(20) DEFAULT 'debit',
  expenses varchar(200) DEFAULT NULL,
  department varchar(100) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bill_drive_id varchar(200) DEFAULT NULL,
  CONSTRAINT cc_transactions_txn_type_chk CHECK (txn_type IS NULL OR txn_type IN ('debit','credit')),
  PRIMARY KEY (id),
  CONSTRAINT cc_transactions_cc_transactions_ibfk_1 FOREIGN KEY (statement_id) REFERENCES cc_statements (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE checklist_tasks (
  id int NOT NULL AUTO_INCREMENT,
  description longtext NOT NULL,
  assigned_to int NOT NULL,
  assigned_by int NOT NULL,
  due_date date DEFAULT NULL,
  status varchar(20) DEFAULT 'pending',
  priority varchar(20) DEFAULT 'low',
  remarks longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at datetime DEFAULT NULL,
  proof_replaced smallint NOT NULL DEFAULT '0',
  proof_image longtext,
  frequency varchar(20) DEFAULT NULL,
  proof_video_id varchar(100) DEFAULT NULL,
  proof_video_mime varchar(50) DEFAULT NULL,
  proof_video_replaced smallint NOT NULL DEFAULT '0',
  doer_remark longtext,
  CONSTRAINT checklist_tasks_status_chk CHECK (status IS NULL OR status IN ('pending','completed')),
  CONSTRAINT checklist_tasks_priority_chk CHECK (priority IS NULL OR priority IN ('low','medium','high')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE config (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) DEFAULT NULL,
  email varchar(255) DEFAULT NULL,
  role varchar(255) DEFAULT NULL,
  customer varchar(255) DEFAULT NULL,
  department varchar(255) DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE daily_tasks (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  entry_date date NOT NULL,
  client_name varchar(255) NOT NULL,
  department varchar(255) DEFAULT '',
  description longtext NOT NULL,
  duration_min int NOT NULL DEFAULT '0',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE delegation_tasks (
  id int NOT NULL AUTO_INCREMENT,
  description longtext NOT NULL,
  assigned_to int NOT NULL,
  assigned_by int NOT NULL,
  due_date date DEFAULT NULL,
  status varchar(20) DEFAULT 'pending',
  priority varchar(20) DEFAULT 'low',
  approval varchar(20) DEFAULT 'no',
  waiting_approval smallint DEFAULT '0',
  awaiting_due_date smallint DEFAULT '0',
  remarks longtext,
  url varchar(2048) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at datetime DEFAULT NULL,
  proof_replaced smallint NOT NULL DEFAULT '0',
  proof_image longtext,
  proof_video_id varchar(100) DEFAULT NULL,
  proof_video_mime varchar(50) DEFAULT NULL,
  proof_video_replaced smallint NOT NULL DEFAULT '0',
  doer_remark longtext,
  CONSTRAINT delegation_tasks_status_chk CHECK (status IS NULL OR status IN ('pending','completed','revised')),
  CONSTRAINT delegation_tasks_priority_chk CHECK (priority IS NULL OR priority IN ('low','medium','high','urgent')),
  CONSTRAINT delegation_tasks_approval_chk CHECK (approval IS NULL OR approval IN ('yes','no')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE fms_extra_rows (
  id int NOT NULL AUTO_INCREMENT,
  step_id int NOT NULL,
  row_label varchar(255) DEFAULT '',
  col_letter varchar(10) DEFAULT '',
  field_type varchar(20) DEFAULT 'text',
  dropdown_options longtext,
  required smallint DEFAULT '1',
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE fms_sheets (
  id int NOT NULL AUTO_INCREMENT,
  fms_name varchar(255) DEFAULT '',
  sheet_name varchar(255) NOT NULL,
  sheet_id varchar(255) NOT NULL,
  header_row int DEFAULT '1',
  total_steps int DEFAULT '0',
  intake_config longtext,
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE fms_step_doers (
  id int NOT NULL AUTO_INCREMENT,
  step_id int NOT NULL,
  user_id int NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE fms_steps (
  id int NOT NULL AUTO_INCREMENT,
  fms_id int NOT NULL,
  step_order int NOT NULL,
  step_name varchar(255) NOT NULL,
  plan_col varchar(10) DEFAULT '',
  plan_col_name varchar(255) DEFAULT NULL,
  actual_col varchar(10) DEFAULT '',
  actual_col_name varchar(255) DEFAULT NULL,
  extra_input varchar(10) DEFAULT 'no',
  extra_col varchar(10) DEFAULT '',
  show_cols longtext,
  show_col_names longtext,
  delay_reason_col varchar(10) DEFAULT '',
  delay_reason_col_name varchar(255) DEFAULT NULL,
  doer_name_col varchar(10) DEFAULT '',
  doer_name_col_name varchar(255) DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE holidays (
  id int NOT NULL AUTO_INCREMENT,
  holiday_date date NOT NULL,
  name varchar(255) NOT NULL,
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT holidays_holiday_date_uq UNIQUE (holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE hrm_candidates (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  phone varchar(50) NOT NULL,
  profile_position varchar(255) DEFAULT '',
  interview_date date DEFAULT NULL,
  interview_time varchar(20) DEFAULT '',
  status varchar(20) DEFAULT 'Scheduled',
  reschedule_date date DEFAULT NULL,
  reschedule_time varchar(20) DEFAULT '',
  joining_date date DEFAULT NULL,
  offer_sent smallint DEFAULT '0',
  salary varchar(100) DEFAULT '',
  notes longtext,
  meeting_link varchar(1024) DEFAULT '',
  interviewer_phone varchar(50) DEFAULT '',
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  reschedule_reason longtext,
  offer_drive_id varchar(500) DEFAULT NULL,
  offer_token varchar(64) DEFAULT NULL,
  offer_html longtext,
  CONSTRAINT hrm_candidates_status_chk CHECK (status IS NULL OR status IN ('Scheduled','Rescheduled','Selected','Rejected','Offer Sent')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE hrm_message_log (
  id int NOT NULL AUTO_INCREMENT,
  candidate_id int DEFAULT NULL,
  candidate_name varchar(255) DEFAULT '',
  phone varchar(50) DEFAULT '',
  action varchar(255) DEFAULT '',
  type varchar(20) DEFAULT 'text',
  status varchar(20) DEFAULT 'Failed',
  error_detail longtext,
  payload_json longtext,
  retry_count int DEFAULT '0',
  last_retry_at datetime NULL DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT hrm_message_log_type_chk CHECK (type IS NULL OR type IN ('text','image','file')),
  CONSTRAINT hrm_message_log_status_chk CHECK (status IS NULL OR status IN ('Sent','Failed')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE inventory_assignments (
  id int NOT NULL AUTO_INCREMENT,
  item_id int NOT NULL,
  user_id int NOT NULL,
  assigned_by int NOT NULL,
  assigned_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  returned_at datetime NULL DEFAULT NULL,
  handover_status varchar(20) DEFAULT 'active',
  handover_notes longtext,
  CONSTRAINT inventory_assignments_handover_status_chk CHECK (handover_status IS NULL OR handover_status IN ('active','pending_handover','returned')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE inventory_items (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  type varchar(20) NOT NULL,
  brand varchar(255) DEFAULT '',
  model varchar(255) DEFAULT '',
  serial_number varchar(255) DEFAULT '',
  photo longtext,
  item_condition varchar(20) DEFAULT 'good',
  status varchar(20) DEFAULT 'available',
  notes longtext,
  created_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT inventory_items_type_chk CHECK (type IS NULL OR type IN ('laptop','keyboard','mouse','mobile','sim','charger','other')),
  CONSTRAINT inventory_items_item_condition_chk CHECK (item_condition IS NULL OR item_condition IN ('new','good','fair','poor')),
  CONSTRAINT inventory_items_status_chk CHECK (status IS NULL OR status IN ('available','assigned','damaged','retired')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE leave_requests (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  leave_type varchar(20) NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  dates_json longtext,
  reason longtext NOT NULL,
  status varchar(20) DEFAULT 'pending',
  approver_id int DEFAULT NULL,
  approver_note longtext,
  decided_at datetime NULL DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT leave_requests_leave_type_chk CHECK (leave_type IS NULL OR leave_type IN ('full_day','half_day','work_from_home','extra_working')),
  CONSTRAINT leave_requests_status_chk CHECK (status IS NULL OR status IN ('pending','approved','rejected')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE meeting_attendees (
  id int NOT NULL AUTO_INCREMENT,
  meeting_id int NOT NULL,
  user_id int NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT meeting_attendees_uq_meeting_user_uq UNIQUE (meeting_id,user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE meetings (
  id int NOT NULL AUTO_INCREMENT,
  title varchar(255) NOT NULL,
  agenda longtext,
  client_id int DEFAULT NULL,
  organizer_id int NOT NULL,
  meeting_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  meet_link varchar(2048) DEFAULT NULL,
  status varchar(20) DEFAULT 'scheduled',
  recurrence_group_id varchar(40) DEFAULT NULL,
  reminder_sent smallint DEFAULT '0',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NULL DEFAULT NULL,
  CONSTRAINT meetings_status_chk CHECK (status IS NULL OR status IN ('scheduled','cancelled','done')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE message_logs (
  id int NOT NULL AUTO_INCREMENT,
  timestamp datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sender varchar(255) DEFAULT NULL,
  sender_name varchar(255) DEFAULT NULL,
  msg_type varchar(50) DEFAULT NULL,
  raw_text longtext,
  task_id varchar(20) DEFAULT NULL,
  error longtext,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE payment_requests (
  id int NOT NULL AUTO_INCREMENT,
  submitted_by int NOT NULL,
  name varchar(100) NOT NULL,
  bank_name varchar(50) NOT NULL,
  card_number varchar(50) NOT NULL,
  amount decimal(12,2) DEFAULT '0.00',
  reason longtext NOT NULL,
  status varchar(20) DEFAULT 'pending',
  payment_done smallint DEFAULT '0',
  payment_done_at datetime NULL DEFAULT NULL,
  reviewed_at datetime NULL DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payment_requests_status_chk CHECK (status IS NULL OR status IN ('pending','approved','rejected')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE pr_cards (
  id int NOT NULL AUTO_INCREMENT,
  bank_name varchar(50) NOT NULL,
  card_number varchar(50) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT pr_cards_uq_pr_card_uq UNIQUE (bank_name,card_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE queries (
  id int NOT NULL AUTO_INCREMENT,
  user_id int NOT NULL,
  message longtext NOT NULL,
  answer longtext,
  status varchar(20) NOT NULL DEFAULT 'open',
  answered_by int DEFAULT NULL,
  answered_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT queries_status_chk CHECK (status IS NULL OR status IN ('open','answered','rejected')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE task_approvals (
  id int NOT NULL AUTO_INCREMENT,
  task_id int NOT NULL,
  task_type varchar(20) NOT NULL,
  requested_by int NOT NULL,
  requested_to int NOT NULL,
  action_type varchar(50) DEFAULT NULL,
  new_date date DEFAULT NULL,
  status varchar(20) DEFAULT 'pending',
  note longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_approvals_status_chk CHECK (status IS NULL OR status IN ('pending','approved','rejected')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE task_comments (
  id int NOT NULL AUTO_INCREMENT,
  task_id int NOT NULL,
  task_type varchar(20) NOT NULL,
  user_id int NOT NULL,
  comment longtext NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE task_subtasks (
  id int NOT NULL AUTO_INCREMENT,
  task_id int NOT NULL,
  description longtext NOT NULL,
  priority varchar(20) DEFAULT 'low',
  status varchar(20) DEFAULT 'pending',
  created_by int NOT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at datetime NULL DEFAULT NULL,
  CONSTRAINT task_subtasks_priority_chk CHECK (priority IS NULL OR priority IN ('low','medium','high','urgent')),
  CONSTRAINT task_subtasks_status_chk CHECK (status IS NULL OR status IN ('pending','completed')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE task_transfers (
  id int NOT NULL AUTO_INCREMENT,
  task_id int NOT NULL,
  task_type varchar(20) NOT NULL,
  from_user int NOT NULL,
  to_user int NOT NULL,
  requested_by int NOT NULL,
  status varchar(20) DEFAULT 'pending',
  note longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT task_transfers_status_chk CHECK (status IS NULL OR status IN ('pending','approved','rejected')),
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE tasks (
  id int NOT NULL AUTO_INCREMENT,
  timestamp datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  task_id varchar(20) NOT NULL,
  task_description longtext,
  assigned_by varchar(255) DEFAULT NULL,
  assignee_contact varchar(255) DEFAULT NULL,
  assigned_to varchar(255) DEFAULT NULL,
  employee_email_id varchar(255) DEFAULT NULL,
  target_date date DEFAULT NULL,
  priority varchar(20) DEFAULT 'Medium',
  approval_needed varchar(10) DEFAULT NULL,
  client_name varchar(255) DEFAULT NULL,
  department varchar(255) DEFAULT NULL,
  assigned_name varchar(255) DEFAULT NULL,
  assigned_email_id varchar(255) DEFAULT NULL,
  comments longtext,
  source_link longtext,
  status varchar(50) DEFAULT 'Pending',
  message_type varchar(20) DEFAULT NULL,
  updated_timestamp datetime DEFAULT NULL,
  description longtext,
  sender_phone varchar(20) DEFAULT NULL,
  sender_name varchar(255) DEFAULT NULL,
  due_date date DEFAULT NULL,
  remarks longtext,
  client_id int DEFAULT NULL,
  url varchar(2048) DEFAULT NULL,
  approved_task_id int DEFAULT NULL,
  purvi_notified smallint DEFAULT '0',
  PRIMARY KEY (id),
  CONSTRAINT tasks_task_id_uq UNIQUE (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE users (
  id int NOT NULL AUTO_INCREMENT,
  name varchar(255) NOT NULL,
  email varchar(255) NOT NULL,
  notification_email varchar(255) DEFAULT '',
  password varchar(255) NOT NULL,
  role varchar(20) DEFAULT 'user',
  view_only smallint NOT NULL DEFAULT '0',
  user_role varchar(20) DEFAULT NULL,
  phone varchar(50) DEFAULT NULL,
  department varchar(255) DEFAULT '',
  week_off varchar(50) DEFAULT '',
  extra_off longtext,
  exclude_from_reminder smallint DEFAULT '0',
  extra_access longtext,
  user_permissions longtext,
  profile_image longtext,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  birthday date DEFAULT NULL,
  joining_date date DEFAULT NULL,
  session_version int NOT NULL DEFAULT '1',
  staff_type varchar(20) NOT NULL DEFAULT 'office',
  CONSTRAINT users_role_chk CHECK (role IS NULL OR role IN ('admin','hod','pc','user','client')),
  CONSTRAINT users_user_role_chk CHECK (user_role IS NULL OR user_role IN ('admin','hod','pc','user','client')),
  CONSTRAINT users_staff_type_chk CHECK (staff_type IS NULL OR staff_type IN ('office','factory')),
  PRIMARY KEY (id),
  CONSTRAINT users_email_uq UNIQUE (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE week_plans (
  id int NOT NULL AUTO_INCREMENT,
  employee_id int NOT NULL,
  hod_id int DEFAULT NULL,
  start_date date NOT NULL,
  target_count int DEFAULT '0',
  improvement_pct decimal(5,2) DEFAULT '0.00',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_committed_score decimal(5,1) DEFAULT NULL,
  user_committed_at datetime NULL DEFAULT NULL,
  checkin_skipped_until date DEFAULT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Indexes
CREATE INDEX cc_transactions_statement_id ON cc_transactions (statement_id);
CREATE INDEX checklist_tasks_idx_assigned_to ON checklist_tasks (assigned_to);
CREATE INDEX checklist_tasks_idx_status ON checklist_tasks (status);
CREATE INDEX checklist_tasks_idx_due_date ON checklist_tasks (due_date);
CREATE INDEX config_idx_name ON config (name);
CREATE INDEX config_idx_email ON config (email);
CREATE INDEX config_idx_customer ON config (customer);
CREATE INDEX config_idx_department ON config (department);
CREATE INDEX daily_tasks_idx_user_date ON daily_tasks (user_id,entry_date);
CREATE INDEX daily_tasks_idx_entry_date ON daily_tasks (entry_date);
CREATE INDEX delegation_tasks_idx_assigned_to ON delegation_tasks (assigned_to);
CREATE INDEX delegation_tasks_idx_status ON delegation_tasks (status);
CREATE INDEX delegation_tasks_idx_due_date ON delegation_tasks (due_date);
CREATE INDEX fms_extra_rows_idx_step ON fms_extra_rows (step_id);
CREATE INDEX fms_step_doers_idx_step ON fms_step_doers (step_id);
CREATE INDEX fms_step_doers_idx_user ON fms_step_doers (user_id);
CREATE INDEX fms_steps_idx_fms ON fms_steps (fms_id);
CREATE INDEX holidays_idx_date ON holidays (holiday_date);
CREATE INDEX hrm_candidates_idx_status ON hrm_candidates (status);
CREATE INDEX hrm_candidates_idx_interview_date ON hrm_candidates (interview_date);
CREATE INDEX hrm_message_log_idx_candidate ON hrm_message_log (candidate_id);
CREATE INDEX hrm_message_log_idx_status ON hrm_message_log (status);
CREATE INDEX inventory_assignments_idx_item ON inventory_assignments (item_id);
CREATE INDEX inventory_assignments_idx_user ON inventory_assignments (user_id);
CREATE INDEX inventory_assignments_idx_handover ON inventory_assignments (handover_status);
CREATE INDEX inventory_items_idx_status ON inventory_items (status);
CREATE INDEX inventory_items_idx_type ON inventory_items (type);
CREATE INDEX leave_requests_idx_user ON leave_requests (user_id);
CREATE INDEX leave_requests_idx_status ON leave_requests (status);
CREATE INDEX leave_requests_idx_approver ON leave_requests (approver_id);
CREATE INDEX leave_requests_idx_from ON leave_requests (from_date);
CREATE INDEX meeting_attendees_idx_meeting ON meeting_attendees (meeting_id);
CREATE INDEX meeting_attendees_idx_user ON meeting_attendees (user_id);
CREATE INDEX meetings_idx_date ON meetings (meeting_date);
CREATE INDEX meetings_idx_organizer ON meetings (organizer_id);
CREATE INDEX meetings_idx_client ON meetings (client_id);
CREATE INDEX meetings_idx_status ON meetings (status);
CREATE INDEX meetings_idx_reminder ON meetings (meeting_date,start_time,reminder_sent,status);
CREATE INDEX meetings_idx_recurrence ON meetings (recurrence_group_id);
CREATE INDEX message_logs_idx_sender ON message_logs (sender);
CREATE INDEX message_logs_idx_task_id ON message_logs (task_id);
CREATE INDEX message_logs_idx_timestamp ON message_logs (timestamp);
CREATE INDEX queries_idx_user ON queries (user_id);
CREATE INDEX queries_idx_status ON queries (status);
CREATE INDEX task_approvals_idx_task ON task_approvals (task_id,task_type);
CREATE INDEX task_approvals_idx_requested_to ON task_approvals (requested_to);
CREATE INDEX task_comments_idx_task ON task_comments (task_id,task_type);
CREATE INDEX task_subtasks_idx_task ON task_subtasks (task_id);
CREATE INDEX tasks_idx_task_id ON tasks (task_id);
CREATE INDEX tasks_idx_status ON tasks (status);
CREATE INDEX tasks_idx_assigned_to ON tasks (assigned_to);
CREATE INDEX tasks_idx_target_date ON tasks (target_date);
CREATE INDEX week_plans_idx_employee ON week_plans (employee_id);
CREATE INDEX week_plans_idx_start ON week_plans (start_date);


-- ── Purane MySQL schema ki do kamiyan jo code pehle se maan kar chalta hai ──
-- Purane DB me week_plans ye dono kabhi mila hi nahi tha:
--   1. updated_at column — server.js use SELECT karta hai (week-plan list API),
--      MySQL par wo query "Unknown column" se fail hoti thi.
--   2. (employee_id, start_date) par UNIQUE — iske bina upsert ka
--      ON DUPLICATE KEY kabhi trigger nahi hota tha, aur har save ek naya
--      duplicate row bana deta tha.
-- Naya DB khaali hai, isliye dono yahan theek kar rahe hain.
ALTER TABLE week_plans ADD COLUMN updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;
ALTER TABLE week_plans ADD CONSTRAINT week_plans_emp_week_uq UNIQUE (employee_id, start_date);

-- Auto-increment counters (warna naye rows purane ids par takrayenge)
ALTER TABLE cc_cards AUTO_INCREMENT = 40;
ALTER TABLE cc_departments AUTO_INCREMENT = 15;
ALTER TABLE cc_statements AUTO_INCREMENT = 40;
ALTER TABLE cc_transactions AUTO_INCREMENT = 526;
ALTER TABLE checklist_tasks AUTO_INCREMENT = 47158;
ALTER TABLE daily_tasks AUTO_INCREMENT = 4834;
ALTER TABLE delegation_tasks AUTO_INCREMENT = 8;
ALTER TABLE fms_extra_rows AUTO_INCREMENT = 36;
ALTER TABLE fms_sheets AUTO_INCREMENT = 6;
ALTER TABLE fms_step_doers AUTO_INCREMENT = 90;
ALTER TABLE fms_steps AUTO_INCREMENT = 59;
ALTER TABLE holidays AUTO_INCREMENT = 3;
ALTER TABLE hrm_candidates AUTO_INCREMENT = 4;
ALTER TABLE hrm_message_log AUTO_INCREMENT = 115;
ALTER TABLE leave_requests AUTO_INCREMENT = 193;
ALTER TABLE meeting_attendees AUTO_INCREMENT = 75;
ALTER TABLE meetings AUTO_INCREMENT = 150;
ALTER TABLE message_logs AUTO_INCREMENT = 29;
ALTER TABLE payment_requests AUTO_INCREMENT = 80;
ALTER TABLE pr_cards AUTO_INCREMENT = 3217;
ALTER TABLE queries AUTO_INCREMENT = 9;
ALTER TABLE task_approvals AUTO_INCREMENT = 44;
ALTER TABLE task_comments AUTO_INCREMENT = 5;
ALTER TABLE task_subtasks AUTO_INCREMENT = 5;
ALTER TABLE task_transfers AUTO_INCREMENT = 25;
ALTER TABLE tasks AUTO_INCREMENT = 66;
ALTER TABLE users AUTO_INCREMENT = 95;
ALTER TABLE week_plans AUTO_INCREMENT = 248;
