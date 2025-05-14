import React, { useState, useEffect, useCallback } from 'react';
import { FedExOptions, FedExOption } from '@/lib/fedexConfig';

interface FedexOptionsModalProps {
  orderId: string;
  // Pass current order's fedex options to pre-fill or an empty object
  currentOrderOptions: {
    fedexServiceType?: string | null;
    fedexPackagingType?: string | null;
    fedexPickupType?: string | null;
    fedexDutiesPaymentType?: string | null;
  };
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccessAndGenerateLabel: (orderId: string) => void; // Callback after successful save
  // Optional: to refresh order data on the parent page after save
  onOrderUpdate?: () => void; 
}

const FedexOptionsModal: React.FC<FedexOptionsModalProps> = ({
  orderId,
  currentOrderOptions,
  isOpen,
  onClose,
  onSaveSuccessAndGenerateLabel,
  onOrderUpdate
}) => {
  const [fedexApiOptions, setFedexApiOptions] = useState<FedExOptions | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedServiceType, setSelectedServiceType] = useState(currentOrderOptions.fedexServiceType || '');
  const [selectedPackagingType, setSelectedPackagingType] = useState(currentOrderOptions.fedexPackagingType || '');
  const [selectedPickupType, setSelectedPickupType] = useState(currentOrderOptions.fedexPickupType || '');
  const [selectedDutiesPaymentType, setSelectedDutiesPaymentType] = useState(currentOrderOptions.fedexDutiesPaymentType || '');

  useEffect(() => {
    if (isOpen) {
      setIsLoadingOptions(true);
      setError(null);
      fetch('/api/fedex/options')
        .then((res) => {
          if (!res.ok) {
            throw new Error('Failed to fetch FedEx options');
          }
          return res.json();
        })
        .then((data: FedExOptions) => {
          setFedexApiOptions(data);
          // Set initial selected values based on currentOrderOptions or defaults from fetched options
          setSelectedServiceType(currentOrderOptions.fedexServiceType || data.serviceTypes[0]?.value || '');
          setSelectedPackagingType(currentOrderOptions.fedexPackagingType || data.packagingTypes[0]?.value || '');
          setSelectedPickupType(currentOrderOptions.fedexPickupType || data.pickupTypes[0]?.value || '');
          setSelectedDutiesPaymentType(currentOrderOptions.fedexDutiesPaymentType || data.dutiesPaymentTypes[0]?.value || '');
        })
        .catch((err) => {
          console.error(err);
          setError(err.message || 'Could not load FedEx options.');
        })
        .finally(() => setIsLoadingOptions(false));
    }
  }, [isOpen, currentOrderOptions]);

  // Update local state if currentOrderOptions prop changes while modal is open
  useEffect(() => {
    setSelectedServiceType(currentOrderOptions.fedexServiceType || (fedexApiOptions?.serviceTypes[0]?.value || ''));
    setSelectedPackagingType(currentOrderOptions.fedexPackagingType || (fedexApiOptions?.packagingTypes[0]?.value || ''));
    setSelectedPickupType(currentOrderOptions.fedexPickupType || (fedexApiOptions?.pickupTypes[0]?.value || ''));
    setSelectedDutiesPaymentType(currentOrderOptions.fedexDutiesPaymentType || (fedexApiOptions?.dutiesPaymentTypes[0]?.value || ''));
  }, [currentOrderOptions, fedexApiOptions]);


  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        fedexServiceType: selectedServiceType,
        fedexPackagingType: selectedPackagingType,
        fedexPickupType: selectedPickupType,
        fedexDutiesPaymentType: selectedDutiesPaymentType,
      };

      const response = await fetch(`/api/orders/${orderId}/updateFedexOptions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to save FedEx options.');
      }
      
      // alert('FedEx options saved!'); // Or use a more sophisticated notification
      if(onOrderUpdate) onOrderUpdate(); // Refresh parent data if callback provided
      onClose(); // Close modal first
      onSaveSuccessAndGenerateLabel(orderId); // Then trigger label generation

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unknown error occurred while saving.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  const renderSelect = (
    label: string, 
    value: string, 
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void, 
    options: FedExOption[] | undefined
  ) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}:</label>
      <select
        value={value}
        onChange={onChange}
        disabled={isLoadingOptions || isSaving || !options}
        className="mt-1 block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm disabled:bg-gray-100"
      >
        {!options && <option value="">Loading...</option>}
        {options?.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
      <div className="relative p-8 border w-full max-w-lg shadow-lg rounded-md bg-white">
        <h3 className="text-xl font-semibold mb-6 text-gray-900">Configure FedEx Options for Order #{orderId.substring(0,8)}...</h3>
        
        {isLoadingOptions && <p>Loading options...</p>}
        {!isLoadingOptions && !fedexApiOptions && !error && <p>Could not load options.</p>}

        {error && <p className="text-red-500 mb-4">Error: {error}</p>}

        {fedexApiOptions && (
          <>
            {renderSelect("Service Type", selectedServiceType, (e) => setSelectedServiceType(e.target.value), fedexApiOptions.serviceTypes)}
            {renderSelect("Packaging Type", selectedPackagingType, (e) => setSelectedPackagingType(e.target.value), fedexApiOptions.packagingTypes)}
            {renderSelect("Pickup Type", selectedPickupType, (e) => setSelectedPickupType(e.target.value), fedexApiOptions.pickupTypes)}
            {renderSelect("Duties/Taxes Payment Type", selectedDutiesPaymentType, (e) => setSelectedDutiesPaymentType(e.target.value), fedexApiOptions.dutiesPaymentTypes)}
            
            <div className="mt-8 flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isLoadingOptions || !fedexApiOptions}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 border border-transparent rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:bg-indigo-300"
              >
                {isSaving ? 'Saving...' : 'Save & Generate Label'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FedexOptionsModal; 