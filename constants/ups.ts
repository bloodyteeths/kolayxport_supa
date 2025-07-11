// UPS Service Types (International)
export const UPS_SERVICE_TYPES = [
  { value: '65', label: 'UPS Saver' },                // UPS Saver
  { value: '07', label: 'UPS Express' },              // UPS Express
  { value: '54', label: 'UPS Express Plus' },         // UPS Express Plus
  { value: '08', label: 'UPS Expedited' },            // UPS Expedited
  { value: '11', label: 'UPS Standard' },             // UPS Standard
  { value: '07', label: 'UPS Worldwide Express' },    // UPS Worldwide Express (same as Express)
  { value: '54', label: 'UPS Worldwide Express Plus' } // UPS Worldwide Express Plus (same as Express Plus)
];

// UPS Package Types
export const UPS_PACKAGE_TYPES = [
  { value: 'UPS_PAK', label: 'UPS Pak' },
  { value: 'UPS_BOX', label: 'UPS Box' },
  { value: 'UPS_EXPRESS_TUBE', label: 'UPS Express Tube' },
  { value: 'UPS_ENVELOPE', label: 'UPS Envelope' },
  { value: 'CUSTOM_PACKAGE', label: 'Custom Packaging' },
];

// UPS Signature Options
export const UPS_SIGNATURE_OPTIONS = [
  { value: 'NO_SIGNATURE', label: 'No Signature Required' },
  { value: 'ADULT_SIGNATURE_REQUIRED', label: 'Adult Signature Required' },
  { value: 'DIRECT_SIGNATURE_REQUIRED', label: 'Direct Signature Required' },
  { value: 'DELIVERY_CONFIRMATION', label: 'Delivery Confirmation' },
];
