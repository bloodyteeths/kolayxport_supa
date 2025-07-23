import React, { useState } from 'react';
import { Chip, Tooltip, IconButton, Dialog, DialogTitle, DialogContent, Typography, Box } from '@mui/material';
import { Info, MapPin, Store } from 'lucide-react';

const EtsyAddressDisplay = ({ order, etsyAddress }) => {
  const [dialogOpen, setDialogOpen] = useState(false);

  // If no Etsy address data, show nothing
  if (!etsyAddress) {
    return null;
  }

  const { shippingAddress, notes, etsyStoreName, etsyStoreId } = etsyAddress;

  // Format address for display
  const formatAddress = (addr) => {
    if (!addr || typeof addr !== 'object') return '';
    
    const parts = [
      addr.line1,
      addr.line2,
      addr.city,
      addr.state,
      addr.postalCode
    ].filter(Boolean);
    
    return parts.join(', ');
  };

  const fullAddress = formatAddress(shippingAddress);
  
  return (
    <>
      {/* Compact display with chip */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          icon={<MapPin size={14} />}
          label="Etsy Adres"
          color="success"
          variant="outlined"
          size="small"
          sx={{ fontSize: '11px' }}
        />
        
        {etsyStoreName && (
          <Chip
            icon={<Store size={14} />}
            label={etsyStoreName}
            color="info"
            variant="outlined" 
            size="small"
            sx={{ fontSize: '11px' }}
          />
        )}
        
        <Tooltip title="Detayları görüntüle">\n          <IconButton \n            size="small" \n            onClick={() => setDialogOpen(true)}\n            sx={{ p: 0.5 }}\n          >\n            <Info size={16} />\n          </IconButton>\n        </Tooltip>
      </Box>

      {/* Detailed dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ pb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MapPin size={20} />
            Etsy Adres Bilgileri
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box sx={{ space: 2 }}>
            {/* Order info */}
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" color="text.secondary">
                Sipariş No: {order.orderNumber || 'N/A'}
              </Typography>
              {etsyStoreName && (
                <Typography variant="subtitle2" color="text.secondary">
                  Mağaza: {etsyStoreName} {etsyStoreId && `(ID: ${etsyStoreId})`}
                </Typography>
              )}
            </Box>

            {/* Shipping address */}
            {shippingAddress && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  📦 Teslimat Adresi
                </Typography>
                <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
                  {shippingAddress.name && (
                    <><strong>{shippingAddress.name}</strong><br /></>
                  )}
                  {shippingAddress.line1}<br />
                  {shippingAddress.line2 && <>{shippingAddress.line2}<br /></>}
                  {shippingAddress.city}, {shippingAddress.state} {shippingAddress.postalCode}<br />
                  {shippingAddress.country}
                </Typography>
              </Box>
            )}

            {/* Notes */}
            {notes && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
                  📝 Notlar
                </Typography>
                <Typography variant="body2" sx={{ 
                  backgroundColor: '#f5f5f5', 
                  p: 1, 
                  borderRadius: 1,
                  fontStyle: 'italic'
                }}>
                  {notes}
                </Typography>
              </Box>
            )}

            {/* Sync info */}
            <Box sx={{
              mt: 2,
              pt: 2,
              borderTop: '1px solid #e0e0e0'
            }}>
              <Typography variant="caption" color="text.secondary">
                ✅ Chrome uzantısı ile senkronize edildi
                <br />
                Son güncelleme: {new Date(etsyAddress.updatedAt).toLocaleString('tr-TR')}
              </Typography>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default EtsyAddressDisplay;