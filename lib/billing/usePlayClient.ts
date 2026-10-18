// lib/billing/usePlayClient.ts — hydration-safe isPlayClient() for server-rendered pages (marketing header/footer):
// false on the server and the first client render, then the real value once mounted.
import { useEffect, useState } from 'react';
import { isPlayClient } from './playClient';

export function usePlayClient(): boolean {
  const [play, setPlay] = useState(false);
  useEffect(() => setPlay(isPlayClient()), []);
  return play;
}
