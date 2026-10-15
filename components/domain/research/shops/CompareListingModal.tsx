// components/domain/research/shops/CompareListingModal.tsx (research R3-B) — "Compare with my listing" (research.md
// §8.1 panel primary): a listing picker over the viewer's own listings (every connected shop of the marketplace),
// then Product finder compare with that listing's main keyword (title lead phrase) and the listing itself.
// Read-only: nothing is staged or sent.
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ds/overlay/Modal';
import { FormField } from '@/components/ds/inputs/FormField';
import { Combobox, type ComboboxOption } from '@/components/ds/inputs/Combobox';
import { Thumb } from '@/components/ds/data/Thumb';
import { fetchOwnListings } from '@/components/domain/research/keywords/AddTagsAction';
import { compareHref, type ShopMkt, type ShopT } from './shopModel';

export type CompareListingModalProps = {
  open: boolean;
  onClose: () => void;
  mkt: ShopMkt;
  /** Navigate (the page owns the router; tests pass a spy). */
  go: (href: string) => void;
  /** Test seam for the listing search. */
  search?: (mkt: ShopMkt, q: string) => Promise<{ id: string; title: string; thumbUrl: string | null }[]>;
};

async function searchOwn(mkt: ShopMkt, q: string) {
  const rows = await fetchOwnListings(mkt, q);
  return rows.map(({ row }) => ({ id: row.id, title: row.title, thumbUrl: row.thumbUrl ?? null }));
}

export function CompareListingModal({ open, onClose, mkt, go, search = searchOwn }: CompareListingModalProps) {
  const t = useTranslations() as unknown as ShopT;
  const [picked, setPicked] = React.useState<ComboboxOption | null>(null);
  React.useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  const loadOptions = React.useCallback(
    async (q: string): Promise<ComboboxOption[]> => {
      const rows = await search(mkt, q);
      return rows.slice(0, 50).map((r) => ({ value: r.id, label: r.title, leading: <Thumb src={r.thumbUrl} alt="" size={32} /> }));
    },
    [search, mkt],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('research.shops.compareTitle')}
      description={t('research.shops.compareBody')}
      primary={{
        id: 'shops-compare-go',
        label: t('research.action.compare'),
        disabled: !picked,
        disabledReason: t('research.shops.pickListing'),
        onClick: () => {
          if (!picked) return;
          go(compareHref({ id: picked.value, title: picked.label }, mkt));
          onClose();
        },
      }}
      data-testid="shops-compare-modal"
    >
      <FormField label={t('research.shops.myListing')}>
        <Combobox
          value={picked}
          onChange={setPicked}
          loadOptions={loadOptions}
          placeholder={t('research.shops.searchMyListings')}
          noOptionsText={t('research.shops.noOwnListings')}
          debounceMs={300}
          data-testid="shops-compare-picker"
        />
      </FormField>
    </Modal>
  );
}

export default CompareListingModal;
