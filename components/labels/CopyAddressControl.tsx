import React, { useState } from 'react';
import { Button, ButtonGroup, Menu, MenuItem, ListItemText } from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useTranslations } from 'next-intl';
import { useCopy } from '@/lib/hooks/useCopy';
import {
  formatAddressForCopy,
  defaultAddressStyle,
  type AddressCopyStyle,
  type CopyableAddress,
} from '@/lib/format/address';

interface CopyAddressControlProps {
  address: CopyableAddress | null | undefined;
  size?: 'small' | 'medium';
}

/**
 * "Copy address" split button: the main part copies in the format that fits the
 * address country (TR for Turkish addresses, international otherwise); the
 * arrow lets the user pick the other format.
 */
export default function CopyAddressControl({ address, size = 'small' }: CopyAddressControlProps) {
  const t = useTranslations('labels');
  const { copy, copied } = useCopy({ successMessage: t('addressCopied') });
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const text = (style: AddressCopyStyle) => formatAddressForCopy(address || null, style);
  const isEmpty = !text('intl');
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const doCopy = async (style: AddressCopyStyle) => {
    setAnchorEl(null);
    await copy(text(style));
  };

  const tap = { minHeight: { xs: 44, md: size === 'small' ? 32 : 36 }, textTransform: 'none' as const };

  return (
    <>
      <ButtonGroup
        variant="outlined"
        size={size}
        disabled={isEmpty}
        onMouseDown={stop}
        onTouchStart={stop}
        aria-label={t('copyAddress')}
      >
        <Button
          type="button"
          startIcon={copied ? <CheckRoundedIcon sx={{ fontSize: 16 }} /> : <ContentCopyRoundedIcon sx={{ fontSize: 16 }} />}
          color={copied ? 'success' : 'primary'}
          onClick={(e) => {
            e.stopPropagation();
            void doCopy(defaultAddressStyle(address || null));
          }}
          sx={tap}
        >
          {t('copyAddress')}
        </Button>
        <Button
          type="button"
          aria-label={t('addressFormatMenu')}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            setAnchorEl(e.currentTarget);
          }}
          sx={{ ...tap, minWidth: { xs: 44, md: 32 }, px: 0.5 }}
        >
          <ArrowDropDownIcon fontSize="small" />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        onClick={stop}
      >
        <MenuItem onClick={() => void doCopy('intl')} sx={{ minHeight: 44 }}>
          <ListItemText primary={t('addressFormatIntl')} />
        </MenuItem>
        <MenuItem onClick={() => void doCopy('tr')} sx={{ minHeight: 44 }}>
          <ListItemText primary={t('addressFormatTr')} />
        </MenuItem>
      </Menu>
    </>
  );
}
