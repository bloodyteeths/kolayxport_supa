import { fetchVeeqoOrders } from '../lib/veeqo';
import { fetchCreatedOrders, fetchShipmentUpdates } from '../lib/trendyol';
import { fetchShippoOrders } from '../lib/shippo';
import { getSheetValues, appendSheetValues } from '../lib/googleSheets';

describe('Helper modules error handling', () => {
  test('fetchVeeqoOrders should throw if apiKey is missing', async () => {
    await expect(fetchVeeqoOrders({ apiKey: '' })).rejects.toThrow('Missing Veeqo API key');
  });

  test('fetchCreatedOrders should throw if credentials missing', async () => {
    await expect(fetchCreatedOrders({})).rejects.toThrow('Missing Trendyol credentials');
  });

  test('fetchShipmentUpdates should throw if credentials missing', async () => {
    await expect(fetchShipmentUpdates({})).rejects.toThrow('Missing Trendyol credentials');
  });

  test('fetchShippoOrders should throw if token is missing', async () => {
    await expect(fetchShippoOrders({ token: '' })).rejects.toThrow('Missing Shippo token');
  });

  test('getSheetValues should throw if credentials missing', async () => {
    await expect(getSheetValues({ clientEmail: '', privateKey: '', spreadsheetId: '', range: '' }))
      .rejects.toThrow('Missing Google Sheets credentials');
  });

  test('appendSheetValues should throw if credentials missing', async () => {
    await expect(appendSheetValues({ clientEmail: '', privateKey: '', spreadsheetId: '', range: '', values: [] }))
      .rejects.toThrow('Missing Google Sheets credentials');
  });
}); 