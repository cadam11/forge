-- Forge regression-test fixture schema (PostgreSQL).
-- Identical logical shape to the mssql and mysql fixtures.

DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders      CASCADE;
DROP TABLE IF EXISTS customers   CASCADE;
DROP TABLE IF EXISTS products    CASCADE;

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  sku         VARCHAR(32)  NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  price_cents INTEGER      NOT NULL,
  category    VARCHAR(50)  NOT NULL,
  active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX ix_products_category ON products(category);

CREATE TABLE customers (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(200) NOT NULL UNIQUE,
  full_name    VARCHAR(200) NOT NULL,
  signup_date  DATE         NOT NULL,
  country_code CHAR(2)      NOT NULL
);
CREATE INDEX ix_customers_country ON customers(country_code);

CREATE TABLE orders (
  id          SERIAL PRIMARY KEY,
  customer_id INTEGER     NOT NULL REFERENCES customers(id),
  order_date  TIMESTAMP   NOT NULL,
  status      VARCHAR(20) NOT NULL,
  total_cents INTEGER     NOT NULL
);
CREATE INDEX ix_orders_customer ON orders(customer_id);
CREATE INDEX ix_orders_status   ON orders(status);

CREATE TABLE order_items (
  id          SERIAL PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL,
  price_cents INTEGER NOT NULL
);
CREATE INDEX ix_order_items_order ON order_items(order_id);
