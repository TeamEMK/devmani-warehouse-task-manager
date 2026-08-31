-- Kaam ki na rahi cheezein hata do.  (Postgres wali file ka MySQL roop —
-- wajah aur dayra wahi hai, sirf likhne ka tareeka alag.)
--
--   1. CLIENT feature — ab app me hai hi nahi. Sabse zyada matlab
--      delegation_tasks / checklist_tasks par client_id ke index ka hai: un par
--      ab koi query nahi chalti, par HAR task insert unhe update karta hai.
--      MySQL me column hatate hi uske index apne aap chale jaate hain, isliye
--      neeche sirf column hataye hain.
--
--   2. PURANE legacy tables — meetings, tasks, daily_tasks, config,
--      message_logs. Kisi purane system se aayi thi; is app ka code inme se
--      kisi ko na padhta hai na likhta, isliye har copy me khaali rehti hain.
--
-- Ye migration WAPAS nahi ho sakti. Pehle dekh lein ki kuch hai to nahi:
--
--   SELECT 'meetings' t, count(*) n FROM meetings
--   UNION ALL SELECT 'tasks', count(*) FROM tasks
--   UNION ALL SELECT 'daily_tasks', count(*) FROM daily_tasks
--   UNION ALL SELECT 'config', count(*) FROM config
--   UNION ALL SELECT 'message_logs', count(*) FROM message_logs
--   UNION ALL SELECT 'clients', count(*) FROM clients;
--
-- MySQL me `ALTER TABLE ... DROP COLUMN IF EXISTS` hota hi nahi. Aur ye file
-- NAYE database par bhi chalti hai, jahan 001_init.sql ne ye column banaya hi
-- nahi hota — wahan seedha DROP likhne se migration ruk jaata. Isliye pehle
-- information_schema se poochte hain, aur tabhi DROP banate hain; warna
-- `DO 0` (MySQL ka "kuch mat karo") chal jaata hai.

-- ── 1. Client feature ─────────────────────────────────
SET @s := IF((SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'delegation_tasks'
                 AND column_name = 'client_id') > 0,
             'ALTER TABLE delegation_tasks DROP COLUMN client_id', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := IF((SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'checklist_tasks'
                 AND column_name = 'client_id') > 0,
             'ALTER TABLE checklist_tasks DROP COLUMN client_id', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @s := IF((SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'users'
                 AND column_name = 'client_id') > 0,
             'ALTER TABLE users DROP COLUMN client_id', 'DO 0');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

DROP TABLE IF EXISTS client_department_folders;
DROP TABLE IF EXISTS client_feedback;
DROP TABLE IF EXISTS client_handlers;
DROP TABLE IF EXISTS clients;

-- ── 2. Purane legacy tables ───────────────────────────
DROP TABLE IF EXISTS meetings;
DROP TABLE IF EXISTS daily_tasks;
DROP TABLE IF EXISTS message_logs;
DROP TABLE IF EXISTS config;
DROP TABLE IF EXISTS tasks;
