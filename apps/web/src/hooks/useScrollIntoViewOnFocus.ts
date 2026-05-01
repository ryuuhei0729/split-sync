'use client';

import { useEffect } from 'react';

export function useScrollIntoViewOnFocus(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return; // Android Web など visualViewport 非対応環境はスキップ

    let focusedEl: HTMLElement | null = null;

    const isFormField = (el: EventTarget | null): el is HTMLElement => {
      if (!el || !(el instanceof Element)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };

    const scrollIfBelowFold = () => {
      if (!focusedEl) return;
      const rect = focusedEl.getBoundingClientRect();
      if (rect.top > vv.height / 2) {
        focusedEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (isFormField(e.target)) {
        focusedEl = e.target;
        // visualViewport の resize が来るのを待つ (iOS Safari)
      }
    };

    const onFocusOut = () => {
      focusedEl = null;
    };

    let prevHeight = vv.height;

    const onResize = () => {
      // 高さが縮小した場合のみスクロール (キーボード展開を検知)
      if (vv.height < prevHeight) {
        scrollIfBelowFold();
      }
      prevHeight = vv.height;
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    vv.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      vv.removeEventListener('resize', onResize);
    };
  }, []);
}
