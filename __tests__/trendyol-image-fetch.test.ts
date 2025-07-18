import { mapTrendyolOrdersWithImages } from '../lib/mappers/trendyol';
import { getProductImages, imageCache } from '../lib/integrations/trendyolClient';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the fetch function
global.fetch = vi.fn();

describe('Trendyol Image Fetching', () => {
  beforeEach(() => {
    // Clear the image cache before each test
    imageCache.clear();
    vi.clearAllMocks();
  });

  it('should fetch product images for Trendyol orders', async () => {
    // Mock API response
    const mockApiResponse = {
      content: [
        {
          barcode: '123456789',
          images: [{ url: 'https://example.com/image1.jpg' }]
        },
        {
          barcode: '987654321',
          images: [{ url: 'https://example.com/image2.jpg' }]
        }
      ]
    };

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse
    });

    // Sample Trendyol orders
    const orders = [
      {
        id: '1',
        orderNumber: 'TR001',
        lines: [
          {
            id: '1',
            productName: 'Test Product 1',
            barcode: '123456789',
            price: 100,
            quantity: 1
          },
          {
            id: '2',
            productName: 'Test Product 2',
            barcode: '987654321',
            price: 200,
            quantity: 1
          }
        ]
      }
    ];

    const credentials = {
      supplierId: 'test-supplier',
      apiKey: 'test-key',
      apiSecret: 'test-secret'
    };

    const result = await mapTrendyolOrdersWithImages(orders, credentials);

    expect(result).toHaveLength(1);
    expect(result[0].line_items).toHaveLength(2);
    expect(result[0].line_items[0].image).toBe('https://example.com/image1.jpg');
    expect(result[0].line_items[1].image).toBe('https://example.com/image2.jpg');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should use cached images when available', async () => {
    // Pre-populate cache
    imageCache.set('123456789', {
      url: 'https://cached-image.jpg',
      timestamp: Date.now()
    });

    const orders = [
      {
        id: '1',
        orderNumber: 'TR001',
        lines: [
          {
            id: '1',
            productName: 'Test Product',
            barcode: '123456789',
            price: 100,
            quantity: 1
          }
        ]
      }
    ];

    const credentials = {
      supplierId: 'test-supplier',
      apiKey: 'test-key',
      apiSecret: 'test-secret'
    };

    const result = await mapTrendyolOrdersWithImages(orders, credentials);

    expect(result[0].line_items[0].image).toBe('https://cached-image.jpg');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should fallback to regular mapping when no credentials provided', async () => {
    const orders = [
      {
        id: '1',
        orderNumber: 'TR001',
        lines: [
          {
            id: '1',
            productName: 'Test Product',
            barcode: '123456789',
            price: 100,
            quantity: 1
          }
        ]
      }
    ];

    const result = await mapTrendyolOrdersWithImages(orders);

    expect(result).toHaveLength(1);
    expect(result[0].line_items[0].image).toBe('');
    expect(global.fetch).not.toHaveBeenCalled();
  });
}); 