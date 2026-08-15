-- Joinery regression-test fixture schema (MSSQL).
-- Synthetic e-commerce shape: products, customers, orders, order_items.
-- Identical logical shape to the postgres and mysql fixtures.

IF OBJECT_ID('dbo.order_items', 'U') IS NOT NULL DROP TABLE dbo.order_items;
IF OBJECT_ID('dbo.orders', 'U')      IS NOT NULL DROP TABLE dbo.orders;
IF OBJECT_ID('dbo.customers', 'U')   IS NOT NULL DROP TABLE dbo.customers;
IF OBJECT_ID('dbo.products', 'U')    IS NOT NULL DROP TABLE dbo.products;

CREATE TABLE products (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  sku         NVARCHAR(32)  NOT NULL UNIQUE,
  name        NVARCHAR(200) NOT NULL,
  price_cents INT           NOT NULL,
  category    NVARCHAR(50)  NOT NULL,
  active      BIT           NOT NULL CONSTRAINT df_products_active DEFAULT 1,
  created_at  DATETIME2     NOT NULL CONSTRAINT df_products_created DEFAULT SYSUTCDATETIME()
);
CREATE INDEX ix_products_category ON products(category);

CREATE TABLE customers (
  id           INT IDENTITY(1,1) PRIMARY KEY,
  email        NVARCHAR(200) NOT NULL UNIQUE,
  full_name    NVARCHAR(200) NOT NULL,
  signup_date  DATE          NOT NULL,
  country_code CHAR(2)       NOT NULL
);
CREATE INDEX ix_customers_country ON customers(country_code);

CREATE TABLE orders (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  customer_id INT          NOT NULL,
  order_date  DATETIME2    NOT NULL,
  status      NVARCHAR(20) NOT NULL,
  total_cents INT          NOT NULL,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
);
CREATE INDEX ix_orders_customer ON orders(customer_id);
CREATE INDEX ix_orders_status   ON orders(status);

CREATE TABLE order_items (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  order_id    INT NOT NULL,
  product_id  INT NOT NULL,
  quantity    INT NOT NULL,
  price_cents INT NOT NULL,
  CONSTRAINT fk_order_items_order   FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
);
CREATE INDEX ix_order_items_order ON order_items(order_id);
