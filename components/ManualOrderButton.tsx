import React, { useState } from 'react';
import { Button } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import ManualOrderForm from './ManualOrderForm';

interface ManualOrderButtonProps {
  onOrderCreated?: () => void;
}

export default function ManualOrderButton({ onOrderCreated }: ManualOrderButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleOpenDialog = () => {
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
  };

  const handleOrderSuccess = () => {
    setDialogOpen(false);
    if (onOrderCreated) {
      onOrderCreated();
    }
  };

  return (
    <>
      <Button
        variant="contained"
        color="primary"
        onClick={handleOpenDialog}
        startIcon={<AddIcon />}
        sx={{
          height: '40px',
          minWidth: 160,
          fontWeight: 600,
          textTransform: 'none',
          borderRadius: 1
        }}
      >
        Manuel Sipariş Ekle
      </Button>

      <ManualOrderForm
        open={dialogOpen}
        onClose={handleCloseDialog}
        onSuccess={handleOrderSuccess}
      />
    </>
  );
}