// lib/theme.tsx — MUI v5 theme built from lib/ds/tokens.ts. Legacy-safe: spacing 8, floating labels intact,
// h1–h6 kept (remapped). Gradients, purple, hover transforms and heavy shadows are gone.
import type { CSSProperties } from 'react';
import { createTheme, alpha } from '@mui/material/styles';
import type {} from '@mui/x-date-pickers/themeAugmentation';
import {
  neutral as n, accent as a, tone, font, type, elevation as e, focusRing, backdrop,
  zIndex as z, motion, radius, control,
} from './ds/tokens';

declare module '@mui/material/styles' {
  interface Palette { attention: Palette['primary']; neutral: Palette['primary']; }
  interface PaletteOptions { attention?: PaletteOptions['primary']; neutral?: PaletteOptions['primary']; }
  interface TypographyVariants {
    display: CSSProperties; titleLg: CSSProperties; titleMd: CSSProperties;
    titleSm: CSSProperties; dense: CSSProperties; label: CSSProperties; micro: CSSProperties;
  }
  interface TypographyVariantsOptions {
    display?: CSSProperties; titleLg?: CSSProperties; titleMd?: CSSProperties;
    titleSm?: CSSProperties; dense?: CSSProperties; label?: CSSProperties; micro?: CSSProperties;
  }
}
declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    display: true; titleLg: true; titleMd: true; titleSm: true; dense: true; label: true; micro: true;
    // h1–h6 stay enabled for legacy; lint bans them in migrated files.
  }
}

// Index signature makes the result assignable to both React.CSSProperties (custom variants) and MUI TypographyStyleOptions (body1/body2).
const t = (k: keyof typeof type, extra: CSSProperties = {}): CSSProperties & { [key: string]: unknown } => {
  const [size, lh, weight, ls] = type[k];
  return { fontSize: size, lineHeight: `${lh}px`, fontWeight: weight, letterSpacing: ls, ...extra };
};

// Solid accent used for every "contained" color except error — kills legacy green/purple/gradient buttons.
const solidAccent = {
  backgroundColor: a[600], color: '#fff', backgroundImage: 'none',
  '&:hover': { backgroundColor: a[700], boxShadow: 'none' },
  '&:active': { backgroundColor: a[800] },
};
const neutralOutlined = {
  borderColor: n[300], color: n[800], backgroundColor: n[0],
  '&:hover': { backgroundColor: n[50], borderColor: n[400] },
};

const theme = createTheme({
  // spacing intentionally left at MUI default (8) — 112 legacy files rely on it.
  shape: { borderRadius: radius.sm },
  breakpoints: { values: { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } },
  zIndex: {
    mobileStepper: z.tabBar, fab: z.tabBar, speedDial: z.sidebar, appBar: z.topBar,
    drawer: z.drawer, modal: z.modal, snackbar: z.toast, tooltip: z.tooltip,
  },
  palette: {
    mode: 'light',
    primary:   { main: a[600], dark: a[700], light: a[500], contrastText: '#FFFFFF' },
    secondary: { main: n[800], dark: n[900], light: n[600], contrastText: '#FFFFFF' }, // no purple
    success:   { main: tone.success.solid, dark: tone.success.fg, light: tone.success.bg, contrastText: '#FFFFFF' },
    warning:   { main: tone.warning.solid, dark: tone.warning.fg, light: tone.warning.bg, contrastText: '#FFFFFF' },
    error:     { main: tone.danger.solid,  dark: tone.danger.fg,  light: tone.danger.bg,  contrastText: '#FFFFFF' },
    info:      { main: tone.info.solid,    dark: tone.info.fg,    light: tone.info.bg,    contrastText: '#FFFFFF' },
    attention: { main: tone.attention.solid, dark: tone.attention.fg, light: tone.attention.bg, contrastText: '#FFFFFF' },
    neutral:   { main: n[500], dark: n[700], light: n[100], contrastText: '#FFFFFF' },
    grey: { 50: n[50], 100: n[100], 200: n[200], 300: n[300], 400: n[400], 500: n[500], 600: n[600], 700: n[700], 800: n[800], 900: n[900] },
    text: { primary: n[800], secondary: n[500], disabled: n[400] },
    divider: n[200],
    background: { default: n[50], paper: n[0] },
    action: {
      hover: n[50], hoverOpacity: 0.04, selected: a[50], selectedOpacity: 0.08,
      focus: alpha(a[600], 0.12), disabled: n[400], disabledBackground: n[100],
    },
  },
  typography: {
    fontFamily: font.sans,
    fontSize: 14,
    htmlFontSize: 16,
    fontWeightLight: 400, fontWeightRegular: 400, fontWeightMedium: 500, fontWeightBold: 600,
    display: t('display'), titleLg: t('titleLg'), titleMd: t('titleMd'), titleSm: t('titleSm'),
    dense: t('dense'), label: t('label'), micro: t('micro'),
    // legacy remaps (weight 600 max)
    h1: { fontSize: 28, lineHeight: '36px', fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontSize: 24, lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.015em' },
    h3: { fontSize: 20, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.015em' },
    h4: { fontSize: 18, lineHeight: '26px', fontWeight: 600, letterSpacing: '-0.01em' },
    h5: { fontSize: 16, lineHeight: '24px', fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontSize: 14, lineHeight: '20px', fontWeight: 600 },
    subtitle1: { fontSize: 14, lineHeight: '20px', fontWeight: 500, color: n[600] },
    subtitle2: { fontSize: 13, lineHeight: '18px', fontWeight: 500, color: n[500] },
    body1: t('body'),
    body2: t('dense'),
    caption: { ...t('caption'), color: n[500] },
    overline: { ...t('micro'), textTransform: 'none' },
    button: { fontSize: 13, lineHeight: '18px', fontWeight: 500, letterSpacing: 0, textTransform: 'none' },
  },
  // 25 entries: 0 none · 1 e1 · 2–4 e2 · 5–12 e3 · 13–24 e4
  shadows: ['none', e.e1, e.e2, e.e2, e.e2, ...Array(8).fill(e.e3), ...Array(12).fill(e.e4)] as any,
  transitions: {
    duration: {
      shortest: motion.instant, shorter: motion.fast, short: motion.fast, standard: motion.base,
      complex: motion.slow, enteringScreen: motion.base, leavingScreen: motion.fast,
    },
    easing: { easeInOut: motion.ease, easeOut: motion.ease, easeIn: 'cubic-bezier(.4,0,1,1)', sharp: motion.ease },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: n[50], color: n[800],
          scrollbarWidth: 'thin', scrollbarColor: `${n[300]} transparent`,
          WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale',
        },
        '.tnum': { fontVariantNumeric: 'tabular-nums' },
      },
    },

    // ── Buttons ───────────────────────────────────────────────────────────
    MuiButtonBase: { defaultProps: { disableRipple: true } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none', fontWeight: 500, borderRadius: radius.sm, boxShadow: 'none', gap: 6,
          transition: `background-color ${motion.fast}ms ${motion.ease}, border-color ${motion.fast}ms ${motion.ease}`,
          '&:hover': { boxShadow: 'none' },
          '&.Mui-focusVisible, &:focus-visible': { boxShadow: focusRing },
          '&.Mui-disabled': { backgroundImage: 'none' },
          '@media (pointer: coarse)': { minHeight: 36 }, // DS Button sizes md+ to 44 itself; small buttons (split, copy) stay compact on phones
        },
        startIcon: { marginRight: 0, marginLeft: 0 },
        endIcon: { marginLeft: 0, marginRight: 0 },
        sizeSmall:  { minHeight: control.sm, padding: '0 10px', fontSize: 13 },
        sizeMedium: { minHeight: control.md, padding: '0 14px', fontSize: 13 },
        sizeLarge:  { minHeight: control.lg, padding: '0 18px', fontSize: 14 },
        contained: {
          ...solidAccent,
          '&.Mui-disabled': { backgroundColor: n[100], color: n[400] },
        },
        containedPrimary: solidAccent,
        containedSecondary: solidAccent,   // legacy purple → accent
        containedSuccess: solidAccent,     // legacy green "New Listing"/"Sync Data" → accent
        containedInfo: solidAccent,
        containedWarning: solidAccent,
        containedError: {
          backgroundColor: tone.danger.solid, color: '#fff', backgroundImage: 'none',
          '&:hover': { backgroundColor: tone.danger.fg },
        },
        outlined: neutralOutlined,
        outlinedPrimary: neutralOutlined,
        outlinedSecondary: neutralOutlined,
        outlinedSuccess: neutralOutlined,
        outlinedInfo: neutralOutlined,
        outlinedError: { borderColor: tone.danger.border, color: tone.danger.fg, '&:hover': { backgroundColor: tone.danger.bg, borderColor: tone.danger.solid } },
        text: { '&:hover': { backgroundColor: n[50] } },
        textPrimary: { color: a[600], '&:hover': { backgroundColor: a[50] } },
        textInherit: { color: n[700], '&:hover': { backgroundColor: n[50] } },   // DS "ghost"
        textSecondary: { color: n[700], '&:hover': { backgroundColor: n[50] } },
        textError: { color: tone.danger.fg, '&:hover': { backgroundColor: tone.danger.bg } }, // DS "danger-ghost"
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: radius.sm, color: n[500],
          '&:hover': { backgroundColor: n[50], color: n[800] },
          '&.Mui-focusVisible': { boxShadow: focusRing },
        },
        sizeSmall: { width: control.sm, height: control.sm, padding: 6 },
        sizeMedium: { width: control.md, height: control.md, padding: 8 },
        sizeLarge: { width: control.lg, height: control.lg, padding: 10 },
      },
    },
    MuiLink: { defaultProps: { underline: 'hover' }, styleOverrides: { root: { color: a[600], fontWeight: 500 } } },

    // ── Surfaces ──────────────────────────────────────────────────────────
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: { backgroundImage: 'none' },
        elevation0: { border: `1px solid ${n[200]}` },
        outlined: { borderColor: n[200] },
        rounded: { borderRadius: radius.md },
      },
    },
    MuiCard: { defaultProps: { variant: 'outlined' }, styleOverrides: { root: { borderRadius: radius.md, boxShadow: 'none' } } },
    MuiCardContent: { styleOverrides: { root: { padding: 16, '&:last-child': { paddingBottom: 16 } } } },
    MuiAccordion: {
      defaultProps: { elevation: 0, disableGutters: true },
      styleOverrides: {
        root: {
          border: `1px solid ${n[200]}`, borderRadius: radius.md, '&:before': { display: 'none' },
          '&:not(:last-of-type)': { marginBottom: 8 },
        },
      },
    },
    MuiAccordionSummary: { styleOverrides: { root: { minHeight: 48, padding: '0 16px' }, content: { margin: '12px 0' } } },
    MuiDivider: { styleOverrides: { root: { borderColor: n[200] } } },

    // ── Inputs (legacy floating labels keep working; DS FormField renders labels above) ──
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined' } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: radius.sm, backgroundColor: n[0], fontSize: 14,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: n[300] },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: n[400] },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: a[600], borderWidth: 1 },
          '&.Mui-focused': { boxShadow: focusRing },
          '&.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: tone.danger.solid },
          '&.Mui-disabled': { backgroundColor: n[50] },
          '@media (pointer: coarse)': { fontSize: 16 },
        },
        input: { lineHeight: '20px', height: 20, '&::placeholder': { color: n[400], opacity: 1 } },
        inputSizeSmall: { padding: '10px 12px', '@media (pointer: coarse)': { padding: '12px 12px' } }, // 40 / 44
        multiline: { padding: 0 },
        inputMultiline: { padding: '10px 12px', height: 'auto' },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: 14, color: n[500], '&.Mui-focused': { color: a[700] } } } },
    MuiFormLabel: { styleOverrides: { root: { color: n[800], fontSize: 13, fontWeight: 500 } } },
    MuiFormHelperText: { styleOverrides: { root: { margin: '6px 0 0', fontSize: 12, lineHeight: '16px', color: n[500] } } },
    MuiCheckbox: { defaultProps: { size: 'small' }, styleOverrides: { root: { color: n[400], '&.Mui-checked': { color: a[600] } } } },
    MuiRadio: { defaultProps: { size: 'small' }, styleOverrides: { root: { color: n[400], '&.Mui-checked': { color: a[600] } } } },
    MuiSwitch: {
      styleOverrides: {
        switchBase: { '&.Mui-checked': { color: '#fff' }, '&.Mui-checked + .MuiSwitch-track': { backgroundColor: a[600], opacity: 1 } },
        track: { backgroundColor: n[300], opacity: 1, borderRadius: 9999 },
      },
    },

    // ── Floating layers (z-index per DESIGN_SYSTEM §2.8) ─────────────────
    MuiPopover: {
      styleOverrides: {
        root: { zIndex: z.popover },
        paper: { boxShadow: e.e2, border: `1px solid ${n[200]}`, borderRadius: radius.md },
      },
    },
    MuiMenu: {
      styleOverrides: {
        root: { zIndex: z.popover },
        paper: { boxShadow: e.e2, border: `1px solid ${n[200]}`, borderRadius: radius.md, minWidth: 180 },
        list: { padding: 4 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 36, fontSize: 14, borderRadius: radius.xs, margin: '0 4px', padding: '0 8px', gap: 8,
          '&:hover': { backgroundColor: n[50] },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: a[50] },
          '@media (pointer: coarse)': { minHeight: 44 },
        },
      },
    },
    MuiAutocomplete: {
      styleOverrides: {
        popper: { zIndex: z.popover },
        paper: { boxShadow: e.e2, border: `1px solid ${n[200]}`, borderRadius: radius.md },
        option: { fontSize: 14, minHeight: 36 },
        tag: { height: 24, borderRadius: 9999 },
        // The popup/clear indicators are IconButtons: without this the global IconButton sizeMedium (40×40) applied
        // inside the field, so a narrow combobox (phone "+90", currency "₺ TRY") wrapped its
        // chevron onto a second line and grew to ~80px. Keep them 24px glyph buttons; the field is the hit area.
        popupIndicator: { width: 24, height: 24, padding: 4, marginRight: 0 },
        clearIndicator: { width: 24, height: 24, padding: 4, marginRight: 0 },
      },
    },
    // x-date-pickers v6 default is zIndex.modal; lift it into the popover layer so it opens above dialogs.
    MuiPickersPopper: { styleOverrides: { root: { zIndex: z.popover } } },
    MuiTooltip: {
      defaultProps: { arrow: false, enterDelay: 400, enterNextDelay: 200 },
      styleOverrides: { tooltip: { backgroundColor: n[900], fontSize: 12, lineHeight: '16px', fontWeight: 500, borderRadius: radius.xs, padding: '4px 8px' } },
    },
    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: radius.lg, boxShadow: e.e4, border: 'none' },
        // Full-screen dialogs on phones: keep the title/close below the iPhone status bar (home-screen app) and the
        // actions above the home indicator.
        paperFullScreen: { borderRadius: 0, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: 16, lineHeight: '24px', fontWeight: 600, padding: '20px 20px 8px' } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 20px', fontSize: 14 } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 20px 20px', gap: 8, '& > :not(:first-of-type)': { marginLeft: 0 } } } },
    MuiDrawer: {
      styleOverrides: {
        paper: { boxShadow: e.e3, border: 'none' },
        paperAnchorRight: { borderTopLeftRadius: radius.lg, borderBottomLeftRadius: radius.lg },
        paperAnchorBottom: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
      },
    },
    MuiBackdrop: {
      styleOverrides: { root: { backgroundColor: backdrop }, invisible: { backgroundColor: 'transparent' } },
    },
    MuiSnackbar: { defaultProps: { anchorOrigin: { vertical: 'bottom', horizontal: 'center' } } },

    // ── Navigation ───────────────────────────────────────────────────────
    MuiTabs: { styleOverrides: { root: { minHeight: 40 }, indicator: { height: 2, backgroundColor: a[600] } } },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none', minHeight: 40, minWidth: 0, padding: '0 12px', fontSize: 13, fontWeight: 500,
          color: n[500], '&.Mui-selected': { color: n[900] },
        },
      },
    },

    // ── Data display ─────────────────────────────────────────────────────
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 9999, height: 24, fontSize: 12, fontWeight: 500, textTransform: 'none' },
        sizeSmall: { height: 20, fontSize: 11 },
        label: { padding: '0 8px' },
        outlined: { borderColor: n[200] },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: radius.md, border: '1px solid', fontSize: 14, padding: '6px 12px', alignItems: 'center' },
        standardSuccess: { backgroundColor: tone.success.bg, borderColor: tone.success.border, color: tone.success.fg },
        standardWarning: { backgroundColor: tone.warning.bg, borderColor: tone.warning.border, color: tone.warning.fg },
        standardError:   { backgroundColor: tone.danger.bg,  borderColor: tone.danger.border,  color: tone.danger.fg },
        standardInfo:    { backgroundColor: tone.info.bg,    borderColor: tone.info.border,    color: tone.info.fg },
        icon: { padding: 0, marginRight: 8, opacity: 1 },
        message: { padding: '4px 0' },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { height: 6, borderRadius: 9999, backgroundColor: n[100] }, bar: { borderRadius: 9999 } },
    },
    MuiSkeleton: { defaultProps: { animation: 'wave' }, styleOverrides: { root: { backgroundColor: n[100] } } },
    MuiTableHead: { styleOverrides: { root: { backgroundColor: n[25] } } },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': { backgroundColor: n[50] },
          '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: a[50], boxShadow: `inset 2px 0 0 ${a[600]}` },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${n[100]}`, padding: '0 12px', height: 44, fontSize: 13, color: n[800] },
        head: { height: 36, fontSize: 12, fontWeight: 500, color: n[500], borderBottom: `1px solid ${n[200]}`, textTransform: 'none', whiteSpace: 'nowrap' },
        sizeSmall: { height: 36, padding: '0 12px' },
        paddingCheckbox: { width: 44, padding: '0 0 0 8px' },
      },
    },
  },
});

export default theme;
export { theme };
