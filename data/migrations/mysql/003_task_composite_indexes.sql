-- Task tables ke index ko asli query shape par laao.
-- Wajah aur naap migrations/postgres/003_task_composite_indexes.sql me likhe
-- hain — 47,000 rows par poora suite 3x kam blocks padhta hai aur index size
-- bhi kam ho jaata hai.
--
-- MySQL me `DROP INDEX IF EXISTS` nahi hota, isliye seedha DROP. Ye migration
-- ek hi baar chalti hai (schema_migrations me darj hoti hai), aur ye teeno
-- index 001_init.sql banata hai — to maujood honge hi.

CREATE INDEX checklist_tasks_idx_doer_status_due
    ON checklist_tasks (assigned_to, status, due_date);
CREATE INDEX checklist_tasks_idx_status_due
    ON checklist_tasks (status, due_date);

CREATE INDEX delegation_tasks_idx_doer_status_due
    ON delegation_tasks (assigned_to, status, due_date);
CREATE INDEX delegation_tasks_idx_status_due
    ON delegation_tasks (status, due_date);

DROP INDEX checklist_tasks_idx_assigned_to ON checklist_tasks;
DROP INDEX checklist_tasks_idx_status      ON checklist_tasks;
DROP INDEX checklist_tasks_idx_due_date    ON checklist_tasks;

DROP INDEX delegation_tasks_idx_assigned_to ON delegation_tasks;
DROP INDEX delegation_tasks_idx_status      ON delegation_tasks;
DROP INDEX delegation_tasks_idx_due_date    ON delegation_tasks;
