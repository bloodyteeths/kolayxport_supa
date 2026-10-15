// components/ds/inputs/DateRangeField.tsx — DS §3.3 / §4.3: presets next to a two-month x-date-pickers v6
// `DateCalendar` in a Popover (z 1600 via theme); a bottom sheet with presets + one month on mobile.
// Applies on a preset click or on the second date pick: there is no Apply button.
import { createContext, useContext, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Drawer from '@mui/material/Drawer';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { PickersDay, type PickersDayProps } from '@mui/x-date-pickers/PickersDay';
import { tr as trLocale, enUS, enGB } from 'date-fns/locale';
import { useTranslations } from 'next-intl';
import { neutral, accent, radius, control, zIndex, type as typeScale, layout } from '@/lib/ds/tokens';
import { COARSE, focusVisibleSx, useFieldContext, useIntlLocale } from './_shared';
import { IconCalendar, IconDisclose, ICON_STROKE } from './_icons';
import {
  DEFAULT_PRESETS, addMonthsSafe, formatRange, inRange, isEdge, nextRange, resolvePreset,
  type DateRangeValue, type PresetKey,
} from './_dates';
import type { DsBaseProps, FieldSize } from './types';

export type { DateRangeValue, PresetKey } from './_dates';
export { resolvePreset, DEFAULT_PRESETS } from './_dates';

export interface DateRangeFieldProps extends DsBaseProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  presets?: PresetKey[];
  min?: Date;
  max?: Date;
  size?: FieldSize;
  /** Filter-style prefix: "Order date: Last 30 days". */
  label?: string;
  /** Trigger text when nothing is chosen. Defaults to "Any date". */
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  /** Force the sheet (tests, narrow containers). Default: below the MUI `md` breakpoint. */
  forceMobile?: boolean;
}

/** date-fns locale for the calendar: TR weeks start on Monday, en-US on Sunday. */
export function dateFnsLocale(intlLocale: string) {
  if (intlLocale.startsWith('tr')) return trLocale;
  if (intlLocale === 'en-US') return enUS;
  return enGB;
}

const RangeCtx = createContext<{ from: Date | null; to: Date | null }>({ from: null, to: null });

function RangeDay(props: PickersDayProps<Date>) {
  const { from, to } = useContext(RangeCtx);
  const { day, outsideCurrentMonth, ...rest } = props;
  const within = !outsideCurrentMonth && inRange(day, from, to);
  const edge = !outsideCurrentMonth && isEdge(day, from, to);
  return (
    <PickersDay
      {...rest}
      day={day}
      outsideCurrentMonth={outsideCurrentMonth}
      selected={edge}
      aria-selected={edge || within || undefined}
      sx={{
        borderRadius: `${radius.sm}px`,
        ...(within && !edge ? { backgroundColor: accent[50], color: accent[800], '&:hover': { backgroundColor: accent[100] } } : null),
        ...(edge ? { backgroundColor: `${accent[600]} !important`, color: `${neutral[0]} !important` } : null),
      }}
    />
  );
}

export function DateRangeField({
  value, onChange, presets = DEFAULT_PRESETS, min, max, size = 'sm', label, placeholder, id, disabled, forceMobile,
  className, 'data-testid': testId,
}: DateRangeFieldProps) {
  const t = useTranslations('ds.inputs.dateRange');
  const locale = useIntlLocale();
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
  const mobile = forceMobile ?? isNarrow;
  const field = useFieldContext();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: Date | null; to: Date | null }>({ from: value.from, to: value.to });
  const [month, setMonth] = useState<Date>(() => {
    const base = value.to ?? value.from ?? new Date();
    return addMonthsSafe(base, value.to ? -1 : 0);
  });
  const adapterLocale = useMemo(() => dateFnsLocale(locale), [locale]);

  const openPicker = () => {
    setDraft({ from: value.from, to: value.to });
    const base = value.to ?? value.from ?? new Date();
    setMonth(addMonthsSafe(base, mobile || !value.to ? 0 : -1));
    setOpen(true);
  };

  const valueText = (() => {
    if (value.preset && value.preset !== 'custom') return t(`preset.${value.preset}`);
    if (value.from && value.to) return formatRange(value.from, value.to, locale);
    if (value.from) return formatRange(value.from, value.from, locale);
    return placeholder ?? t('any');
  })();
  const triggerText = label ? t('labelValue', { label, value: valueText }) : valueText;
  const datesText = value.from && value.to ? formatRange(value.from, value.to, locale) : undefined;

  const pickPreset = (key: PresetKey) => {
    if (key === 'custom') {
      setDraft({ from: null, to: null });
      return;
    }
    const r = resolvePreset(key);
    onChange({ from: r.from, to: r.to, preset: key });
    setOpen(false);
  };

  const pickDay = (day: Date | null) => {
    if (!day) return;
    const r = nextRange(draft, day);
    setDraft({ from: r.from, to: r.to });
    if (r.complete && r.to) {
      onChange({ from: r.from, to: r.to, preset: 'custom' });
      setOpen(false);
    }
  };

  const activePreset = value.preset ?? (value.from ? 'custom' : undefined);

  const presetList = (
    <Box
      role="group"
      aria-label={t('presets')}
      sx={mobile
        ? { display: 'flex', gap: '6px', overflowX: 'auto', pb: '4px' }
        : { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 160, pr: '12px', borderRight: `1px solid ${neutral[200]}` }}
    >
      {presets.map((p) => {
        const active = activePreset === p;
        return (
          <ButtonBase
            key={p}
            onClick={() => pickPreset(p)}
            aria-pressed={active}
            sx={{
              justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'nowrap',
              height: mobile ? control.sm : 32, px: mobile ? '12px' : '10px', borderRadius: `${mobile ? radius.full : radius.sm}px`,
              fontSize: 13, fontWeight: active ? 500 : 400,
              color: active ? accent[700] : neutral[700],
              backgroundColor: active ? accent[50] : 'transparent',
              border: mobile ? `1px solid ${active ? accent[200] : neutral[200]}` : 'none',
              '&:hover': { backgroundColor: active ? accent[50] : neutral[50] },
              ...focusVisibleSx,
              [COARSE]: { height: control.lg },
            }}
          >
            {t(`preset.${p}`)}
          </ButtonBase>
        );
      })}
    </Box>
  );

  const calendar = (offset: number) => {
    const ref = addMonthsSafe(month, offset);
    return (
      <DateCalendar<Date>
        key={`${ref.getFullYear()}-${ref.getMonth()}`}
        value={null}
        referenceDate={ref}
        onChange={pickDay}
        onMonthChange={(m) => setMonth(addMonthsSafe(m, -offset))}
        views={['day']}
        minDate={min}
        maxDate={max}
        slots={{ day: RangeDay }}
        sx={{ width: 296, height: 'auto', minHeight: 300, m: 0, '& .MuiPickersCalendarHeader-label': { fontSize: 14, fontWeight: 600 } }}
      />
    );
  };

  const body = (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={adapterLocale}>
      <RangeCtx.Provider value={draft}>
        <Box sx={{ display: 'flex', flexDirection: mobile ? 'column' : 'row', gap: '12px', p: mobile ? '0 16px 16px' : '12px' }}>
          {presetList}
          <Box sx={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            {calendar(0)}
            {mobile ? null : calendar(1)}
          </Box>
        </Box>
        <Box aria-live="polite" sx={{ px: '16px', pb: '12px', fontSize: 12, color: neutral[500], minHeight: 16 }}>
          {draft.from && !draft.to ? t('pickEnd') : null}
        </Box>
      </RangeCtx.Provider>
    </LocalizationProvider>
  );

  return (
    <>
      <ButtonBase
        ref={anchor}
        id={id ?? field?.id}
        onClick={openPicker}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={datesText && datesText !== triggerText ? `${triggerText} (${datesText})` : undefined}
        aria-describedby={field?.describedBy}
        className={className}
        data-testid={testId}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: '6px', height: control[size], px: size === 'sm' ? '10px' : '12px',
          border: `1px solid ${neutral[300]}`, borderRadius: `${radius.sm}px`, backgroundColor: neutral[0],
          fontSize: size === 'sm' ? 13 : 14, fontWeight: typeScale.label[2], color: neutral[800], whiteSpace: 'nowrap',
          maxWidth: layout.fieldMax,
          '&:hover': { backgroundColor: neutral[50], borderColor: neutral[400] },
          '&.Mui-disabled': { color: neutral[400], backgroundColor: neutral[50] },
          ...focusVisibleSx,
          [COARSE]: { height: control.lg },
        }}
      >
        <IconCalendar size={16} strokeWidth={ICON_STROKE} aria-hidden />
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{triggerText}</Box>
        <IconDisclose size={16} strokeWidth={ICON_STROKE} aria-hidden />
      </ButtonBase>

      {mobile ? (
        <Drawer
          anchor="bottom"
          open={open}
          onClose={() => setOpen(false)}
          // The sheet is the mobile form of a popover: it must open above a DS Modal (z 1500), e.g. "Schedule send…".
          sx={{ zIndex: zIndex.popover }}
          PaperProps={{ 'aria-label': t('dialogLabel'), role: 'dialog', sx: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, pb: 'env(safe-area-inset-bottom)' } } as Record<string, unknown>}
        >
          <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, backgroundColor: neutral[300], m: '8px auto 4px' }} />
          <Box sx={{ px: '16px', py: '8px', fontSize: typeScale.titleMd[0], fontWeight: 600, color: neutral[900] }}>{label ?? t('dialogLabel')}</Box>
          {body}
        </Drawer>
      ) : (
        <Popover
          open={open}
          anchorEl={anchor.current}
          onClose={() => setOpen(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{ paper: { 'aria-label': t('dialogLabel'), role: 'dialog', sx: { mt: '4px' } } as Record<string, unknown> }}
        >
          {body}
        </Popover>
      )}
    </>
  );
}

export default DateRangeField;
