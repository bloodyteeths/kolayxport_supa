// lib/theme.tsx
import { createTheme } from '@mui/material/styles';

const brandBlue = '#2563eb';
const brandIndigo = '#4f46e5';

const theme = createTheme({
  palette: {
    primary: {
      main: brandBlue,
      light: '#60a5fa',
      dark: '#1d4ed8',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#7c3aed',
      light: '#a78bfa',
      dark: '#5b21b6',
    },
    success: {
      main: '#10b981',
      light: '#d1fae5',
      dark: '#059669',
    },
    warning: {
      main: '#f59e0b',
      light: '#fef3c7',
      dark: '#d97706',
    },
    error: {
      main: '#ef4444',
      light: '#fee2e2',
      dark: '#dc2626',
    },
    info: {
      main: '#3b82f6',
      light: '#dbeafe',
      dark: '#2563eb',
    },
    grey: {
      50: '#f8fafc',
      100: '#f1f5f9',
      200: '#e2e8f0',
      300: '#cbd5e1',
      400: '#94a3b8',
      500: '#64748b',
      600: '#475569',
      700: '#334155',
      800: '#1e293b',
      900: '#0f172a',
    },
    background: {
      default: '#f8fafc',
      paper: '#ffffff',
    },
    divider: 'rgba(0, 0, 0, 0.06)',
    text: {
      primary: '#0f172a',
      secondary: '#64748b',
    },
  },
  typography: {
    fontFamily: '"Inter", "Helvetica Neue", "Arial", sans-serif',
    fontWeightMedium: 600,
    fontWeightBold: 700,
    h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.2 },
    h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.3 },
    h3: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.4 },
    h4: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.4 },
    h5: { fontSize: '1rem', fontWeight: 600, letterSpacing: '-0.01em' },
    h6: { fontSize: '0.875rem', fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle1: { fontSize: '1rem', fontWeight: 500, color: '#64748b' },
    subtitle2: { fontSize: '0.875rem', fontWeight: 500, color: '#64748b' },
    body1: { fontSize: '0.9375rem', lineHeight: 1.6 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
    button: { fontWeight: 600, letterSpacing: '0.01em' },
    caption: { fontSize: '0.75rem', color: '#94a3b8' },
    overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
  },
  shape: {
    borderRadius: 12,
  },
  shadows: [
    'none',
    '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
    '0 1px 3px rgba(0,0,0,0.06), 0 2px 6px rgba(0,0,0,0.04)',
    '0 2px 4px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.06)',
    '0 4px 6px rgba(0,0,0,0.04), 0 6px 12px rgba(0,0,0,0.06)',
    '0 6px 10px rgba(0,0,0,0.05), 0 8px 16px rgba(0,0,0,0.06)',
    '0 8px 14px rgba(0,0,0,0.06), 0 10px 20px rgba(0,0,0,0.08)',
    '0 10px 18px rgba(0,0,0,0.06), 0 12px 24px rgba(0,0,0,0.08)',
    '0 12px 22px rgba(0,0,0,0.07), 0 14px 28px rgba(0,0,0,0.09)',
    '0 14px 26px rgba(0,0,0,0.07), 0 16px 32px rgba(0,0,0,0.09)',
    '0 16px 30px rgba(0,0,0,0.08), 0 18px 36px rgba(0,0,0,0.10)',
    '0 18px 34px rgba(0,0,0,0.08), 0 20px 40px rgba(0,0,0,0.10)',
    '0 20px 38px rgba(0,0,0,0.09), 0 22px 44px rgba(0,0,0,0.11)',
    '0 22px 42px rgba(0,0,0,0.09), 0 24px 48px rgba(0,0,0,0.11)',
    '0 24px 46px rgba(0,0,0,0.10), 0 26px 52px rgba(0,0,0,0.12)',
    '0 26px 50px rgba(0,0,0,0.10), 0 28px 56px rgba(0,0,0,0.12)',
    '0 28px 54px rgba(0,0,0,0.11), 0 30px 60px rgba(0,0,0,0.13)',
    '0 30px 58px rgba(0,0,0,0.11), 0 32px 64px rgba(0,0,0,0.13)',
    '0 32px 62px rgba(0,0,0,0.12), 0 34px 68px rgba(0,0,0,0.14)',
    '0 34px 66px rgba(0,0,0,0.12), 0 36px 72px rgba(0,0,0,0.14)',
    '0 36px 70px rgba(0,0,0,0.13), 0 38px 76px rgba(0,0,0,0.15)',
    '0 38px 74px rgba(0,0,0,0.13), 0 40px 80px rgba(0,0,0,0.15)',
    '0 40px 78px rgba(0,0,0,0.14), 0 42px 84px rgba(0,0,0,0.16)',
    '0 42px 82px rgba(0,0,0,0.14), 0 44px 88px rgba(0,0,0,0.16)',
    '0 44px 86px rgba(0,0,0,0.15), 0 46px 92px rgba(0,0,0,0.17)',
  ] as any,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarWidth: 'thin' as const,
          scrollbarColor: '#cbd5e1 transparent',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 600,
          borderRadius: 10,
          boxShadow: 'none',
          padding: '8px 20px',
          transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
          '&:hover': {
            boxShadow: 'none',
          },
        },
        contained: {
          background: `linear-gradient(135deg, ${brandBlue} 0%, ${brandIndigo} 100%)`,
          '&:hover': {
            background: `linear-gradient(135deg, #1d4ed8 0%, #4338ca 100%)`,
            transform: 'translateY(-1px)',
            boxShadow: `0 4px 14px rgba(37, 99, 235, 0.3)`,
          },
        },
        containedError: {
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
            boxShadow: '0 4px 14px rgba(239, 68, 68, 0.3)',
          },
        },
        containedSuccess: {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          '&:hover': {
            background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
          },
        },
        outlined: {
          borderColor: '#e2e8f0',
          color: '#334155',
          '&:hover': {
            backgroundColor: '#f8fafc',
            borderColor: '#cbd5e1',
          },
        },
        text: {
          color: '#64748b',
          '&:hover': {
            backgroundColor: '#f1f5f9',
          },
        },
        sizeSmall: {
          padding: '4px 12px',
          fontSize: '0.8125rem',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid rgba(0, 0, 0, 0.06)',
          backgroundImage: 'none',
        },
        elevation1: {
          boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
        },
        elevation2: {
          boxShadow: '0 2px 4px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.06)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid rgba(0, 0, 0, 0.06)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          transition: 'box-shadow 0.2s ease, transform 0.2s ease',
          '&:hover': {
            boxShadow: '0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)',
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 500,
          fontSize: '0.8125rem',
        },
        sizeSmall: {
          fontSize: '0.75rem',
          height: 24,
        },
        outlined: {
          borderColor: '#e2e8f0',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.08)',
        },
        root: {
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(4px)',
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        root: {
          '& .MuiBackdrop-root': {
            backgroundColor: 'rgba(15, 23, 42, 0.3)',
            backdropFilter: 'blur(4px)',
          },
        },
        paper: {
          borderRadius: 0,
          border: 'none',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
            '& fieldset': {
              borderColor: '#e2e8f0',
              transition: 'border-color 0.15s ease',
            },
            '&:hover fieldset': {
              borderColor: '#cbd5e1',
            },
            '&.Mui-focused fieldset': {
              borderColor: brandBlue,
              borderWidth: '1.5px',
            },
          },
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          border: '1px solid #e2e8f0',
          borderRadius: '12px !important',
          boxShadow: 'none',
          '&:before': {
            display: 'none',
          },
          '&.Mui-expanded': {
            margin: '0 0 12px 0',
          },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          '&.Mui-expanded': {
            minHeight: 48,
          },
        },
        content: {
          '&.Mui-expanded': {
            margin: '12px 0',
          },
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: '#1e293b',
          borderRadius: 8,
          fontSize: '0.75rem',
          fontWeight: 500,
          padding: '6px 12px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        },
        arrow: {
          color: '#1e293b',
        },
      },
    },
    // MuiDataGrid styles are in globals.css (not part of core MUI types)
    MuiLinearProgress: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 6,
          backgroundColor: '#e2e8f0',
        },
        bar: {
          borderRadius: 999,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none' as const,
          fontWeight: 500,
          fontSize: '0.875rem',
          minHeight: 44,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        indicator: {
          height: 2.5,
          borderRadius: '2px 2px 0 0',
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 500,
        },
        standardSuccess: {
          backgroundColor: '#f0fdf4',
          color: '#166534',
        },
        standardError: {
          backgroundColor: '#fef2f2',
          color: '#991b1b',
        },
        standardWarning: {
          backgroundColor: '#fffbeb',
          color: '#92400e',
        },
        standardInfo: {
          backgroundColor: '#eff6ff',
          color: '#1e40af',
        },
      },
    },
    MuiSelect: {
      styleOverrides: {
        root: {
          borderRadius: 10,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          borderRadius: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1), 0 2px 6px rgba(0,0,0,0.05)',
          border: '1px solid #e2e8f0',
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          margin: '2px 6px',
          padding: '8px 12px',
          fontSize: '0.875rem',
          '&.Mui-selected': {
            backgroundColor: '#eff6ff',
            '&:hover': {
              backgroundColor: '#dbeafe',
            },
          },
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          padding: 8,
        },
        switchBase: {
          '&.Mui-checked': {
            color: '#fff',
            '& + .MuiSwitch-track': {
              backgroundColor: brandBlue,
              opacity: 1,
            },
          },
        },
        track: {
          borderRadius: 12,
          backgroundColor: '#cbd5e1',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: '#f1f5f9',
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            backgroundColor: '#f8fafc',
            fontWeight: 600,
            fontSize: '0.8125rem',
            color: '#475569',
            borderBottom: '2px solid #e2e8f0',
          },
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: '#f8fafc',
          },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderColor: '#f1f5f9',
          fontSize: '0.875rem',
        },
      },
    },
  },
});

export default theme;
