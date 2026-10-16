import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

/** DS §2.10: below MUI `md` (900px) the app is in its mobile layout. */
export function useIsMobile(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('md'));
}

/** CRITIQUE X4: 900–1199px (rail sidebar) is "narrow" for the toolbar overflow rule. */
export function useIsNarrow(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('lg'));
}

/** True below 600px (phones). Tools that need a grid (bulk edit, photo studio) still work on tablets. */
export function useIsPhone(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm'));
}
