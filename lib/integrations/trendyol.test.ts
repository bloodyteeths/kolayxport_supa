import { fetchTrendyolOrders, TrendyolOrder } from './trendyol';

// Mock the config module
jest.mock('../config', () => ({
  isTrendyolEnabled: jest.fn(() => true),
}));

// Mock the logger
jest.mock('../logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock node-fetch
jest.mock('node-fetch', () => jest.fn());

describe('Trendyol API Client', () => {
  const mockCredentials = {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    supplierId: 'test-supplier-123',
  };

  it('should throw error for missing credentials', async () => {
    await expect(
      fetchTrendyolOrders({
        apiKey: '',
        apiSecret: 'secret',
        supplierId: 'supplier',
      })
    ).rejects.toThrow('Missing Trendyol credentials');

    await expect(
      fetchTrendyolOrders({
        apiKey: 'key',
        apiSecret: '',
        supplierId: 'supplier',
      })
    ).rejects.toThrow('Missing Trendyol credentials');

    await expect(
      fetchTrendyolOrders({
        apiKey: 'key',
        apiSecret: 'secret',
        supplierId: '',
      })
    ).rejects.toThrow('Missing Trendyol credentials');
  });

  it('should return empty array when feature flag is disabled', async () => {
    // Mock the config to return false
    const mockConfig = require('../config');
    mockConfig.isTrendyolEnabled.mockReturnValue(false);

    const orders = await fetchTrendyolOrders(mockCredentials);

    expect(orders).toEqual([]);
    
    // Reset mock
    mockConfig.isTrendyolEnabled.mockReturnValue(true);
  });

  it('should validate TrendyolOrder interface structure', () => {
    const mockOrder: TrendyolOrder = {
      id: 'order-123',
      orderNumber: 'TY-2025-001',
      status: 'Created',
      customerName: 'Test Customer',
      totalPrice: 299.99,
      currency: 'TRY',
      orderDate: '2025-01-12T10:00:00Z',
      shippingAddress: {
        firstName: 'Test',
        lastName: 'Customer',
        address1: 'Test Address 1',
        city: 'Istanbul',
        district: 'Besiktas',
        postalCode: '34000',
        phone: '+905551234567',
      },
      lineItems: [
        {
          id: 'item-1',
          title: 'Test Product',
          quantity: 2,
          price: 149.99,
          sku: 'TEST-SKU-001',
          barcode: '1234567890123',
          productCode: 'TEST-PROD-001',
        },
      ],
    };

    // Validate the structure compiles correctly
    expect(mockOrder.id).toBe('order-123');
    expect(mockOrder.lineItems).toHaveLength(1);
    expect(mockOrder.shippingAddress?.city).toBe('Istanbul');
  });
}); 