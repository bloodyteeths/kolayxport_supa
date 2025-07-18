import { showLimitToast } from './limitToast';

export async function fetchWithLimit(input: RequestInfo, init?: RequestInit) {
  const res = await fetch(input, init);
  if (res.status === 402) {
    showLimitToast();
  }
  return res;
} 