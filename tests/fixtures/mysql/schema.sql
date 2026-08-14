-- Forge regression-test fixture schema (MySQL 8).
-- Identical logical shape to the mssql and postgres fixtures.

DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS products;

CREATE TABLE products (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sku         VARCHAR(32)  NOT NULL UNIQUE,
  name        VARCHAR(200) NOT NULL,
  price_cents INT          NOT NULL,
  category    VARCHAR(50)  NOT NULL,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_products_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE customers (
  id           INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(200) NOT NULL UNIQUE,
  full_name    VARCHAR(200) NOT NULL,
  signup_date  DATE         NOT NULL,
  country_code CHAR(2)      NOT NULL,
  INDEX ix_customers_country (country_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE orders (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  customer_id INT          NOT NULL,
  order_date  DATETIME     NOT NULL,
  status      VARCHAR(20)  NOT NULL,
  total_cents INT          NOT NULL,
  INDEX ix_orders_customer (customer_id),
  INDEX ix_orders_status (status),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE order_items (
  id          INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id    INT NOT NULL,
  product_id  INT NOT NULL,
  quantity    INT NOT NULL,
  price_cents INT NOT NULL,
  INDEX ix_order_items_order (order_id),
  CONSTRAINT fk_order_items_order   FOREIGN KEY (order_id)   REFERENCES orders(id)   ON DELETE CASCADE,
  CONSTRAINT fk_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
