-- Deterministic seed data for the regression fixture (PostgreSQL).
-- 10 products, 5 customers, 8 orders, 15 order items.

INSERT INTO products (sku, name, price_cents, category, active) VALUES
  ('SKU-LAPTOP-01',  'MacBook Air M4',                           119900, 'electronics', TRUE),
  ('SKU-LAPTOP-02',  'MacBook Pro 14',                           199900, 'electronics', TRUE),
  ('SKU-PHONE-01',   'iPhone 16',                                 79900, 'electronics', TRUE),
  ('SKU-PHONE-02',   'iPhone 16 Pro',                             99900, 'electronics', TRUE),
  ('SKU-BOOK-01',    'Designing Data-Intensive Applications',      4499, 'books',       TRUE),
  ('SKU-BOOK-02',    'The Pragmatic Programmer',                   3999, 'books',       TRUE),
  ('SKU-COFFEE-01',  'Espresso Machine',                          89900, 'kitchen',     TRUE),
  ('SKU-COFFEE-02',  'Coffee Grinder',                            14900, 'kitchen',     TRUE),
  ('SKU-DESK-01',    'Standing Desk',                             49900, 'furniture',   TRUE),
  ('SKU-CHAIR-01',   'Ergonomic Chair',                           39900, 'furniture',   FALSE);

INSERT INTO customers (email, full_name, signup_date, country_code) VALUES
  ('alice@example.com', 'Alice Anderson', '2024-01-15', 'US'),
  ('bob@example.com',   'Bob Baxter',     '2024-03-22', 'CA'),
  ('carol@example.com', 'Carol Chen',     '2024-06-10', 'GB'),
  ('dave@example.com',  'Dave Diaz',      '2024-09-01', 'AU'),
  ('eve@example.com',   'Eve Evans',      '2025-01-20', 'DE');

INSERT INTO orders (customer_id, order_date, status, total_cents) VALUES
  (1, '2025-02-01', 'delivered', 124399),
  (1, '2025-02-15', 'shipped',     8498),
  (2, '2025-02-20', 'delivered', 229700),
  (3, '2025-03-01', 'pending',    79900),
  (4, '2025-03-10', 'cancelled',  89900),
  (5, '2025-03-15', 'delivered', 108398),
  (2, '2025-04-01', 'shipped',    64800),
  (1, '2025-04-15', 'pending',   108898);

INSERT INTO order_items (order_id, product_id, quantity, price_cents) VALUES
  (1,  1, 1, 119900),
  (1,  5, 1,   4499),
  (2,  5, 1,   4499),
  (2,  6, 1,   3999),
  (3,  2, 1, 199900),
  (3,  8, 2,  14900),
  (4,  3, 1,  79900),
  (5,  7, 1,  89900),
  (6,  5, 1,   4499),
  (6,  6, 1,   3999),
  (6,  4, 1,  99900),
  (7,  9, 1,  49900),
  (7,  8, 1,  14900),
  (8,  4, 1,  99900),
  (8,  5, 2,   4499);
