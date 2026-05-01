'use client';

import { useScrollIntoViewOnFocus } from '@/hooks/useScrollIntoViewOnFocus';

export function KeyboardScrollProvider({ children }: { children: React.ReactNode }) {
  useScrollIntoViewOnFocus();
  return <>{children}</>;
}
