-- MySQL Initialization Script
-- Creates test database with sample data

USE testdb;

-- Create sample tables
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    stock INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    total DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

-- Create a stored procedure
DELIMITER //
CREATE PROCEDURE GetUserOrders(IN userId INT)
BEGIN
    SELECT * FROM order_summary WHERE username = (SELECT username FROM users WHERE id = userId);
END //
DELIMITER ;

-- Grant permissions
GRANT ALL PRIVILEGES ON testdb.* TO 'testuser'@'%';
FLUSH PRIVILEGES;
