// MongoDB Initialization Script
// Creates test database with sample data

db = db.getSiblingDB('testdb');

// Create collections with sample data
db.users.insertMany([
    {
        username: 'alice',
        email: 'alice@example.com',
        profile: {
            firstName: 'Alice',
            lastName: 'Johnson',
            age: 28
        },
        created: new Date('2024-01-15')
    },
    {
        username: 'bob',
        email: 'bob@example.com',
        profile: {
            firstName: 'Bob',
            lastName: 'Smith',
            age: 35
        },
        created: new Date('2024-02-20')
    },
    {
        username: 'charlie',
        email: 'charlie@example.com',
        profile: {
            firstName: 'Charlie',
            lastName: 'Williams',
            age: 42
        },
        created: new Date('2024-03-10')
    }
]);

db.products.insertMany([
    {
        name: 'Laptop',
        description: 'High-performance laptop for developers',
        price: 1299.99,
        stock: 25,
        tags: ['electronics', 'computers', 'development'],
        created: new Date()
    },
    {
        name: 'Keyboard',
        description: 'Mechanical keyboard with RGB lighting',
        price: 149.99,
        stock: 100,
        tags: ['electronics', 'peripherals', 'gaming'],
        created: new Date()
    },
    {
        name: 'Mouse',
        description: 'Wireless gaming mouse',
        price: 79.99,
        stock: 150,
        tags: ['electronics', 'peripherals', 'gaming'],
        created: new Date()
    }
]);

db.orders.insertMany([
    {
        userId: 'alice',
        items: [
            { productName: 'Laptop', quantity: 1, price: 1299.99 }
        ],
        total: 1299.99,
        status: 'completed',
        created: new Date('2024-01-20')
    },
    {
        userId: 'bob',
        items: [
            { productName: 'Keyboard', quantity: 1, price: 149.99 },
            { productName: 'Mouse', quantity: 1, price: 79.99 }
        ],
        total: 229.98,
        status: 'shipped',
        created: new Date('2024-02-25')
    }
]);

// Create indexes
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 });
db.products.createIndex({ name: 1 });
db.products.createIndex({ tags: 1 });
db.orders.createIndex({ userId: 1 });
db.orders.createIndex({ status: 1 });

print('MongoDB test data initialized successfully');
