-- Deterministic seed data for the regression fixture (MSSQL).
-- 10 products, 5 customers, 8 orders, 15 order items.

INSERT INTO products (sku, name, price_cents, category, active) VALUES
  (N'SKU-LAPTOP-01',  N'MacBook Air M4',                           119900, N'electronics', 1),
  (N'SKU-LAPTOP-02',  N'MacBook Pro 14',                           199900, N'electronics', 1),
  (N'SKU-PHONE-01',   N'iPhone 16',                                 79900, N'electronics', 1),
  (N'SKU-PHONE-02',   N'iPhone 16 Pro',                             99900, N'electronics', 1),
  (N'SKU-BOOK-01',    N'Designing Data-Intensive Applications',      4499, N'books',       1),
  (N'SKU-BOOK-02',    N'The Pragmatic Programmer',                   3999, N'books',       1),
  (N'SKU-COFFEE-01',  N'Espresso Machine',                          89900, N'kitchen',     1),
  (N'SKU-COFFEE-02',  N'Coffee Grinder',                            14900, N'kitchen',     1),
  (N'SKU-DESK-01',    N'Standing Desk',                             49900, N'furniture',   1),
  (N'SKU-CHAIR-01',   N'Ergonomic Chair',                           39900, N'furniture',   0);

INSERT INTO customers (email, full_name, signup_date, country_code) VALUES
  (N'alice@example.com', N'Alice Anderson', '2024-01-15', 'US'),
  (N'bob@example.com',   N'Bob Baxter',     '2024-03-22', 'CA'),
  (N'carol@example.com', N'Carol Chen',     '2024-06-10', 'GB'),
  (N'dave@example.com',  N'Dave Diaz',      '2024-09-01', 'AU'),
  (N'eve@example.com',   N'Eve Evans',      '2025-01-20', 'DE');

INSERT INTO orders (customer_id, order_date, status, total_cents) VALUES
  (1, '2025-02-01', N'delivered', 124399),
  (1, '2025-02-15', N'shipped',     8498),
  (2, '2025-02-20', N'delivered', 229700),
  (3, '2025-03-01', N'pending',    79900),
  (4, '2025-03-10', N'cancelled',  89900),
  (5, '2025-03-15', N'delivered', 108398),
  (2, '2025-04-01', N'shipped',    64800),
  (1, '2025-04-15', N'pending',   108898);

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
