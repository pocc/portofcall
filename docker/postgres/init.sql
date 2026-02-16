-- PostgreSQL Initialization Script
-- Creates test database with sample data

-- Create sample tables
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    total DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- Insert sample data
INSERT INTO users (username, email) VALUES
    ('alice', 'alice@example.com'),
    ('bob', 'bob@example.com'),
    ('charlie', 'charlie@example.com'),
    ('diana', 'diana@example.com'),
    ('eve', 'eve@example.com');

INSERT INTO products (name, description, price, stock) VALUES
    ('Laptop', 'High-performance laptop for developers', 1299.99, 25),
    ('Keyboard', 'Mechanical keyboard with RGB lighting', 149.99, 100),
    ('Mouse', 'Wireless gaming mouse', 79.99, 150),
    ('Monitor', '27-inch 4K display', 499.99, 50),
    ('Headphones', 'Noise-canceling wireless headphones', 299.99, 75),
    ('Webcam', '1080p webcam for video calls', 89.99, 200),
    ('Desk', 'Height-adjustable standing desk', 599.99, 30),
    ('Chair', 'Ergonomic office chair', 399.99, 45);

INSERT INTO orders (user_id, product_id, quantity, total, status) VALUES
    (1, 1, 1, 1299.99, 'completed'),
    (1, 2, 1, 149.99, 'completed'),
    (2, 3, 2, 159.98, 'pending'),
    (3, 4, 1, 499.99, 'shipped'),
    (4, 5, 1, 299.99, 'completed'),
    (5, 6, 3, 269.97, 'processing');

-- Create a view for order summaries
CREATE VIEW order_summary AS
SELECT
    o.id,
    u.username,
    p.name AS product_name,
    o.quantity,
    o.total,
    o.status,
    o.created_at
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id;

-- Create a stored function
CREATE OR REPLACE FUNCTION get_user_order_count(user_id_param INTEGER)
RETURNS INTEGER AS $$
DECLARE
    order_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO order_count FROM orders WHERE user_id = user_id_param;
    RETURN order_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO testuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO testuser;
