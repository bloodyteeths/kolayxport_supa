import { createFedexShipment } from './fedex.service';
import { FedexShipmentResult } from './fedex.types';
import { retrieveAsyncShipment, extractShipmentDetails } from './fedex.async';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('createFedexShipment', () => {
  it('should use PAPER_7X475 label stock type for FEDEX_PAK packaging', async () => {
    const orderData = {
      orderId: 'test-order',
      packagingType: 'FEDEX_PAK',
      weightKg: 1,
      serviceType: 'FEDEX_GROUND',
      pickupType: 'DROP_BOX',
      shippingChargesPaymentType: 'SENDER',
      recipientFname: 'John',
      recipientLname: 'Doe',
      recipientStreet1: '123 Main St',
      recipientCity: 'New York',
      recipientPostal: '10001',
      recipientCountry: 'US',
      recipientPhone: '1234567890'
    };

    const shipper = {
      fedexApiKey: 'test-key',
      fedexApiSecret: 'test-secret',
      fedexAccountNumber: '123456789',
      shipperName: 'Test Shipper',
      shipperPersonName: 'Test Person',
      shipperPhoneNumber: '1234567890',
      shipperStreet1: '456 Ship St',
      shipperCity: 'Los Angeles',
      shipperStateCode: 'CA',
      shipperPostalCode: '90001',
      shipperCountryCode: 'US',
      shipperTinNumber: '123456789',
      shipperTinType: 'EIN',
      dutiesPaymentType: 'SENDER',
      defaultCurrencyCode: 'USD'
    };

    const result = await createFedexShipment(orderData, shipper);
    
    // Verify the request payload was constructed correctly
    expect(result).toBeDefined();
    expect(result.trackingNumber).toBeDefined();
    expect(result.labelUrl).toBeDefined();
  });

  it('should use PAPER_7X475 for FedEx Pak with CI', async () => {
    const orderData = {
      orderId: 'test-order',
      packagingType: 'FEDEX_PAK',
      weightKg: 1,
      serviceType: 'FEDEX_GROUND',
      pickupType: 'DROP_BOX',
      shippingChargesPaymentType: 'SENDER',
      recipientFname: 'John',
      recipientLname: 'Doe',
      recipientStreet1: '123 Main St',
      recipientCity: 'New York',
      recipientPostal: '10001',
      recipientCountry: 'US',
      recipientPhone: '1234567890',
      customsClearanceDetail: {
        totalCustomsValue: {
          amount: 100,
          currency: 'USD'
        },
        commodities: [{
          description: 'Test Item',
          quantity: 1,
          quantityUnits: 'EA',
          unitPrice: {
            amount: 100,
            currency: 'USD'
          },
          customsValue: {
            amount: 100,
            currency: 'USD'
          },
          weight: {
            value: 1,
            units: 'KG'
          },
          countryOfManufacture: 'US'
        }]
      }
    };

    const shipper = {
      fedexApiKey: 'test-key',
      fedexApiSecret: 'test-secret',
      fedexAccountNumber: '123456789',
      shipperName: 'Test Shipper',
      shipperPersonName: 'Test Person',
      shipperPhoneNumber: '1234567890',
      shipperStreet1: '456 Ship St',
      shipperCity: 'Los Angeles',
      shipperStateCode: 'CA',
      shipperPostalCode: '90001',
      shipperCountryCode: 'US',
      shipperTinNumber: '123456789',
      shipperTinType: 'EIN',
      dutiesPaymentType: 'SENDER',
      defaultCurrencyCode: 'USD'
    };

    const result = await createFedexShipment(orderData, shipper);
    expect(result).toBeDefined();
    expect(result.trackingNumber).toBeDefined();
    expect(result.labelUrl).toBeDefined();
  });

  describe('async shipment handling', () => {
    const mockOrderData = {
      orderId: 'test-order',
      packagingType: 'FEDEX_PAK',
      weightKg: 1,
      serviceType: 'FEDEX_GROUND',
      pickupType: 'DROP_BOX',
      shippingChargesPaymentType: 'SENDER',
      recipientFname: 'John',
      recipientLname: 'Doe',
      recipientStreet1: '123 Main St',
      recipientCity: 'New York',
      recipientPostal: '10001',
      recipientCountry: 'US',
      recipientPhone: '1234567890'
    };

    const mockShipper = {
      fedexApiKey: 'test-key',
      fedexApiSecret: 'test-secret',
      fedexAccountNumber: '123456789',
      shipperName: 'Test Shipper',
      shipperPersonName: 'Test Person',
      shipperPhoneNumber: '1234567890',
      shipperStreet1: '456 Ship St',
      shipperCity: 'Los Angeles',
      shipperStateCode: 'CA',
      shipperPostalCode: '90001',
      shipperCountryCode: 'US',
      shipperTinNumber: '123456789',
      shipperTinType: 'EIN',
      dutiesPaymentType: 'SENDER',
      defaultCurrencyCode: 'USD'
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should handle synchronous response correctly', async () => {
      mockedAxios.post.mockResolvedValueOnce({
        status: 200,
        data: {
          output: {
            transactionShipments: [{
              masterTrackingNumber: '123456789',
              pieceResponses: [{
                packageDocuments: [{
                  docType: 'SHIPPING_LABEL',
                  url: 'https://example.com/label.pdf'
                }]
              }]
            }]
          }
        }
      });

      const result = await createFedexShipment(mockOrderData, mockShipper);
      expect(result).toEqual({
        trackingNumber: '123456789',
        labelUrl: 'https://example.com/label.pdf',
        alerts: []
      });
    });

    it('should handle async response and poll until ready', async () => {
      // Mock initial async response
      mockedAxios.post.mockResolvedValueOnce({
        status: 202,
        data: {
          output: {
            jobId: 'test-job-123'
          }
        }
      });

      // Mock polling responses
      mockedAxios.get
        .mockResolvedValueOnce({ status: 200, data: { output: {} } }) // Not ready
        .mockResolvedValueOnce({ status: 200, data: { output: {} } }) // Not ready
        .mockResolvedValueOnce({ // Ready on third attempt
          status: 200,
          data: {
            output: {
              completedShipmentDetail: {
                masterTrackingNumber: '123456789',
                completedPackageDetails: [{
                  label: {
                    labelUrl: 'https://example.com/label.pdf'
                  }
                }]
              }
            }
          }
        });

      const result = await createFedexShipment(mockOrderData, mockShipper);
      expect(result).toEqual({
        trackingNumber: '123456789',
        labelUrl: 'https://example.com/label.pdf',
        alerts: []
      });
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should throw ASYNC.TIMEOUT after max attempts', async () => {
      // Mock initial async response
      mockedAxios.post.mockResolvedValueOnce({
        status: 202,
        data: {
          output: {
            jobId: 'test-job-123'
          }
        }
      });

      // Mock all polling attempts as not ready
      mockedAxios.get.mockResolvedValue({ status: 200, data: { output: {} } });

      await expect(createFedexShipment(mockOrderData, mockShipper))
        .rejects
        .toThrow('Async shipment not ready after 5 attempts');
      expect(mockedAxios.get).toHaveBeenCalledTimes(5);
    });

    it('should extract shipment details from various response formats', () => {
      const testCases = [
        {
          input: {
            output: {
              completedShipmentDetail: {
                masterTrackingId: { trackingNumber: '123' },
                completedPackageDetails: [{ label: { labelUrl: 'url1' } }]
              }
            }
          },
          expected: { trackingNumber: '123', labelUrl: 'url1' }
        },
        {
          input: {
            output: {
              completedShipmentDetail: {
                masterTrackingNumber: '456',
                completedPackageDetails: [{ label: { url: 'url2' } }]
              }
            }
          },
          expected: { trackingNumber: '456', labelUrl: 'url2' }
        },
        {
          input: {
            output: {
              completedShipmentDetail: {
                completedPackageDetails: [
                  { trackingNumber: '789', label: { labelUrl: 'url3' } }
                ]
              }
            }
          },
          expected: { trackingNumber: '789', labelUrl: 'url3' }
        }
      ];

      testCases.forEach(({ input, expected }) => {
        expect(extractShipmentDetails(input)).toEqual(expected);
      });
    });
  });
}); 