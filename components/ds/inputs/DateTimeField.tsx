// components/ds/inputs/DateTimeField.tsx — listing-editor §4.6 / listings-grid "Schedule send…" (CRITIQUE C13).
// One date + time in the SELLER's time zone (not the browser's): `value` is an absolute instant, the picker
// shows and edits the wall clock in `timezone`, and the zone is always printed ("Europe/Istanbul (GMT+3)").
// Built on x-date-pickers v6 DateCalendar + a 15-minute time list; popover z 1600 (theme), sheet on mobile.
import { useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Drawer from '@mui/material/Drawer';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { useTranslations } from 'next-intl';
import { neutral, accent, tone, radius, control, focusRing, zIndex, type as typeScale } from '@/lib/ds/tokens';
import { COARSE, FieldContext, useFieldContext, useIntlLocale } from './_shared';
import { IconCalendar, ICON_STROKE } from './_icons';
import { Select } from './Select';
import { Button } from './Button';
import { dateFnsLocale } from './DateRangeField';
import { formatDateTimeIn, formatTime, tzOffsetLabel, wallTimeIn, zonedTimeToDate, type WallTime } from './_dates';
import type { DsBaseProps, FieldSize } from './types';

export interface DateTimeFieldProps extends DsBaseProps {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** IANA zone the seller works in (account timezone, BUILD_PLAN BR-2), e.g. "Europe/Istanbul". */
  timezone: string;
  min?: Date;
  max?: Date;
  /** Time list step in minutes (default 15). */
  minutesStep?: number;
  /** Time used when a day is picked before any time (default 09:00). */
  defaultTime?: { hour: number; minute: number };
  size?: FieldSize;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  forceMobile?: boolean;
  'aria-label'?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const timeKey = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

export function DateTimeField({
  value, onChange, timezone, min, max, minutesStep = 15, defaultTime = { hour: 9, minute: 0 }, size = 'md', placeholder,
  id, invalid, disabled, forceMobile, className, 'data-testid': testId, 'aria-label': ariaLabel,
}: DateTimeFieldProps) {
  const t = useTranslations('ds.inputs.dateTime');
  const locale = useIntlLocale();
  const theme = useTheme();
  const isNarrow = useMediaQuery(theme.breakpoints.down('md'));
  const mobile = forceMobile ?? isNarrow;
  const field = useFieldContext();
  const anchor = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const adapterLocale = useMemo(() => dateFnsLocale(locale), [locale]);

  const wall = value ? wallTimeIn(value, timezone) : null;
  const minWall = min ? wallTimeIn(min, timezone) : null;
  const maxWall = max ? wallTimeIn(max, timezone) : null;
  const asLocalDay = (w: WallTime) => new Date(w.year, w.month - 1, w.day);
  const outOfRange = Boolean(value && ((min && value < min) || (max && value > max)));
  const isInvalid = Boolean(invalid ?? field?.invalid) || outOfRange;
  const zoneLabel = t('zone', { zone: timezone, offset: tzOffsetLabel(timezone, locale, value ?? new Date()) });

  const emit = (w: WallTime) => onChange(zonedTimeToDate(w, timezone));

  const pickDay = (d: Date | null) => {
    if (!d) return;
    const h = wall?.hour ?? defaultTime.hour;
    const m = wall?.minute ?? defaultTime.minute;
    emit({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: h, minute: m });
  };

  const sameDay = (a: WallTime | null, b: WallTime | null) => Boolean(a && b && a.year === b.year && a.month === b.month && a.day === b.day);
  const timeOptions = useMemo(() => {
    const opts: { value: string; label: string; disabled?: boolean }[] = [];
    const keys = new Set<string>();
    for (let mins = 0; mins < 24 * 60; mins += minutesStep) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      keys.add(timeKey(h, m));
      const beforeMin = sameDay(wall, minWall) && minWall && (h * 60 + m < minWall.hour * 60 + minWall.minute);
      const afterMax = sameDay(wall, maxWall) && maxWall && (h * 60 + m > maxWall.hour * 60 + maxWall.minute);
      opts.push({ value: timeKey(h, m), label: formatTime(h, m, locale), disabled: Boolean(beforeMin || afterMax) });
    }
    if (wall && !keys.has(timeKey(wall.hour, wall.minute))) {
      opts.push({ value: timeKey(wall.hour, wall.minute), label: formatTime(wall.hour, wall.minute, locale) });
      opts.sort((a, b) => a.value.localeCompare(b.value));
    }
    return opts;
  }, [minutesStep, locale, wall?.year, wall?.month, wall?.day, wall?.hour, wall?.minute, minWall?.hour, minWall?.minute, maxWall?.hour, maxWall?.minute]);

  const pickTime = (k: string) => {
    const [h, m] = k.split(':').map(Number);
    const base = wall ?? wallTimeIn(min && min > new Date() ? min : new Date(), timezone);
    emit({ year: base.year, month: base.month, day: base.day, hour: h, minute: m });
  };

  // The popover body is not the FormField's control: reset the field context so the inner time Select does not take
  // the trigger's id / aria-describedby / aria-invalid (context passes through the portal).
  const body = (
    <FieldContext.Provider value={null}>
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={adapterLocale}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px', p: mobile ? '0 16px 16px' : '12px', width: mobile ? 'auto' : 320 }}>
        <DateCalendar<Date>
          value={wall ? asLocalDay(wall) : null}
          onChange={pickDay}
          views={['day']}
          minDate={minWall ? asLocalDay(minWall) : undefined}
          maxDate={maxWall ? asLocalDay(maxWall) : undefined}
          sx={{ width: '100%', maxWidth: 320, height: 'auto', minHeight: 300, m: 0 }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Box component="span" sx={{ fontSize: typeScale.label[0], fontWeight: typeScale.label[2], color: neutral[800], minWidth: 48 }}>{t('time')}</Box>
          <Box sx={{ flex: 1 }}>
            <Select
              value={wall ? timeKey(wall.hour, wall.minute) : null}
              onChange={pickTime}
              options={timeOptions}
              placeholder={t('timePlaceholder')}
              aria-label={t('time')}
              size="md"
            />
          </Box>
        </Box>
        <Box sx={{ fontSize: 12, color: neutral[500] }}>{zoneLabel}</Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          {value ? <Button variant="ghost" size={mobile ? 'xl' : 'md'} onClick={() => { onChange(null); setOpen(false); }}>{t('clear')}</Button> : null}
          <Button variant="secondary" size={mobile ? 'xl' : 'md'} fullWidth={mobile} onClick={() => setOpen(false)}>{t('done')}</Button>
        </Box>
      </Box>
    </LocalizationProvider>
    </FieldContext.Provider>
  );

  return (
    <Box className={className} data-testid={testId} sx={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', maxWidth: 320 }}>
      <ButtonBase
        ref={anchor}
        id={id ?? field?.id}
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-invalid={isInvalid || undefined}
        aria-describedby={field?.describedBy}
        sx={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px', width: '100%', height: control[size],
          px: '12px', border: `1px solid ${isInvalid ? tone.danger.solid : neutral[300]}`, borderRadius: `${radius.sm}px`,
          backgroundColor: disabled ? neutral[50] : neutral[0], fontSize: size === 'sm' ? 13 : 14, textAlign: 'left',
          color: value ? neutral[800] : neutral[400], fontVariantNumeric: 'tabular-nums',
          '&:hover': { borderColor: isInvalid ? tone.danger.solid : neutral[400] },
          '&:focus-visible': { outline: 'none', borderColor: accent[600], boxShadow: focusRing },
          ...(open ? { borderColor: accent[600], boxShadow: focusRing } : null),
          [COARSE]: { height: control.lg, fontSize: 16 },
        }}
      >
        <Box component="span" sx={{ display: 'inline-flex', color: neutral[500] }}><IconCalendar size={16} strokeWidth={ICON_STROKE} aria-hidden /></Box>
        <Box component="span" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? formatDateTimeIn(value, timezone, locale) : placeholder ?? t('placeholder')}
        </Box>
      </ButtonBase>
      <Box component="span" sx={{ fontSize: 12, lineHeight: '16px', color: neutral[500] }}>{zoneLabel}</Box>

      {mobile ? (
        <Drawer
          anchor="bottom"
          open={open}
          onClose={() => setOpen(false)}
          // The sheet is the mobile form of a popover: it must open above a DS Modal (z 1500), e.g. "Schedule send…".
          sx={{ zIndex: zIndex.popover }}
          PaperProps={{ role: 'dialog', 'aria-label': t('dialogLabel'), sx: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, pb: 'env(safe-area-inset-bottom)' } } as Record<string, unknown>}
        >
          <Box aria-hidden sx={{ width: 36, height: 4, borderRadius: 2, backgroundColor: neutral[300], m: '8px auto 4px' }} />
          <Box sx={{ px: '16px', py: '8px', fontSize: typeScale.titleMd[0], fontWeight: 600, color: neutral[900] }}>{t('dialogLabel')}</Box>
          {body}
        </Drawer>
      ) : (
        <Popover
          open={open}
          anchorEl={anchor.current}
          onClose={() => setOpen(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          slotProps={{ paper: { role: 'dialog', 'aria-label': t('dialogLabel'), sx: { mt: '4px' } } as Record<string, unknown> }}
        >
          {body}
        </Popover>
      )}
    </Box>
  );
}

export default DateTimeField;
