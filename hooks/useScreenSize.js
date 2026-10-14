import { useSyncExternalStore } from 'react';

// Tailwind `sm` breakpoint: mobile is anything narrower than 640px.
const MOBILE_QUERY = '(max-width: 639.98px)';

// Server / pre-hydration defaults. During hydration React renders these (so the
// markup matches the SSR HTML) and then re-renders with the real client values.
// On client-side mounts (route changes, which is most in-app navigation) the
// real values are used from the very first render, so phones no longer render
// the desktop layout first and then snap.
const SERVER_WIDTH = 1024;
const SERVER_HEIGHT = 768;

const hasWindow = () => typeof window !== 'undefined';

let cachedMql = null;
function getMql() {
  if (!hasWindow() || typeof window.matchMedia !== 'function') return null;
  if (cachedMql) return cachedMql;
  try {
    cachedMql = window.matchMedia(MOBILE_QUERY);
  } catch {
    cachedMql = null;
  }
  return cachedMql;
}

function subscribeResize(callback) {
  if (!hasWindow()) return () => {};
  window.addEventListener('resize', callback);
  window.addEventListener('orientationchange', callback);
  return () => {
    window.removeEventListener('resize', callback);
    window.removeEventListener('orientationchange', callback);
  };
}

function subscribeMobile(callback) {
  const unsubResize = subscribeResize(callback);
  const mql = getMql();
  if (mql) {
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', callback);
    else if (typeof mql.addListener === 'function') mql.addListener(callback);
  }
  return () => {
    unsubResize();
    if (mql) {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', callback);
      else if (typeof mql.removeListener === 'function') mql.removeListener(callback);
    }
  };
}

const getWidth = () => window.innerWidth;
const getHeight = () => window.innerHeight;
const getIsMobile = () => {
  const mql = getMql();
  return mql ? mql.matches : window.innerWidth < 640;
};
const getServerWidth = () => SERVER_WIDTH;
const getServerHeight = () => SERVER_HEIGHT;
const getServerIsMobile = () => false;

const useScreenSize = () => {
  const width = useSyncExternalStore(subscribeResize, getWidth, getServerWidth);
  const height = useSyncExternalStore(subscribeResize, getHeight, getServerHeight);
  const isMobile = useSyncExternalStore(subscribeMobile, getIsMobile, getServerIsMobile);

  return {
    width,
    height,
    isMobile,
    isDesktop: !isMobile,
  };
};

export default useScreenSize;
