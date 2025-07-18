import { toOrderItem, toOrder } from '../../lib/mappers/trendyol';

describe('Trendyol Mapper', () => {
  it('maps productImage if present', () => {
    const line = { id: '1', productImage: 'https://cdn.trendyol.com/image1.jpg' };
    expect(toOrderItem(line)).toMatchSnapshot();
  });

  it('maps images[0].url if productImage missing', () => {
    const line = { id: '2', images: [{ url: 'https://cdn.trendyol.com/image2.jpg' }] };
    expect(toOrderItem(line)).toMatchSnapshot();
  });

  it('returns empty string if no image fields', () => {
    const line = { id: '3' };
    expect(toOrderItem(line)).toMatchSnapshot();
  });

  it('converts orderDate to ISO string', () => {
    const order = { id: '4', orderDate: 1752068585316, lines: [] };
    expect(toOrder(order)).toMatchSnapshot();
  });

  it('returns undefined for uiOrderDate if orderDate missing', () => {
    const order = { id: '5', lines: [] };
    expect(toOrder(order)).toMatchSnapshot();
  });
}); 