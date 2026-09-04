-- Staff users ka seed. Har boot par chalta hai (data/scripts/ensure-schema.js),
-- INSERT IGNORE hai isliye jo email pehle se hai wo chhoda jaata hai — dobara
-- chalane se kuch nahi bigadta. Naye staff yahin add karo (password bcrypt hash).
-- Sabka shuruaati password: pass123 (login ke baad badalna hai).
INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)
VALUES ('SURESH KUMAR', 'suresh@devmani.net', '$2a$10$xcHgZdrP1itwDOdY.MSmBeYdkOcau3L6sTB2qFwUvd0HXUgmb7aVK', 'user', '8306550583', 'mis Executive', '0', 'office');
INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)
VALUES ('SOURABH JAIN', 'accounts@devmani.net', '$2a$10$00IpxyupnhS1XpdT.y2cWejNSC9wDrazDRtK7jdStXCAAp3eWyDXK', 'user', '8607290798', 'Accounts', '0', 'office');
INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)
VALUES ('SURENDRA JANGRA', 'mangali@devmani.net', '$2a$10$PTVy8sM1ivFZT8uZ.qM3hOCqCfzjpL00AQh7if6FnzqfdfFOnMIbW', 'user', '9817954151', 'Administrator', '0', 'office');
INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)
VALUES ('PRADEEP DUDI', 'pardeepdudi1947@gmail.com', '$2a$10$ABIlRbDM00lZnZxc/PckyOil2C5n0H1aKmNPHavAIM8dJa3C/92H6', 'user', '9992051031', 'Billing', '0', 'office');
INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)
VALUES ('RAJNISH', 'rajnishbhambhu123@gmail.com', '$2a$10$8L2xFujLPSD8AbwUaxJZvehs4dmoHk91EtiV1GeTx2XaxyDuUs7De', 'user', '9813081821', 'Dispatch', '0', 'office');
INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)
VALUES ('SAJJAN SHARMA', 'sharmasajjan525@gmail.com', '$2a$10$2GKbmHEHU9NrcBJyqEjLuuHFiDVl/NaBHOdO34N5J6f3Up6BSK9ey', 'user', '9466262761', 'Dispatch', '0', 'office');
INSERT IGNORE INTO users (name, email, password, role, phone, department, week_off, staff_type)
VALUES ('RAM DAS', 'das051625@gmail.com', '$2a$10$Z8K2iPQhm5m6FGg5MmZZV.GkMJzrBa9uQID0CumFzUiGx8.GPMRdW', 'user', '8683895328', 'Claim', '0', 'office');
