-- Find all orders with null orderNumber
SELECT id, userId, marketplace, marketplaceKey, orderNumber, createdAt, updatedAt
FROM "Order"
WHERE orderNumber IS NULL
ORDER BY createdAt DESC;

-- Find all order items with null orderNumber
SELECT id, orderId, sku, productName, orderNumber, uniqueLineKey
FROM "OrderItem"
WHERE orderNumber IS NULL
ORDER BY id DESC;
