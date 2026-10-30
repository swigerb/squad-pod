import { useEffect, useState } from 'react';
import { readKeyboardViewport, type KeyboardViewport, type ViewportBaselines } from './keyboardViewport.js';

const CLOSED: KeyboardViewport = { keyboardOpen: false, clampHeight: null };
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit']);
function editableFocused(): boolean {
  const element = document.activeElement;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(element.type);
  return element instanceof HTMLElement && element.isContentEditable;
}

export function useKeyboardViewport(enabled: boolean, onChange?: (viewport: KeyboardViewport) => void): KeyboardViewport {
  const [viewport, setViewport] = useState(CLOSED);
  useEffect(() => {
    if (!enabled) {
      setViewport(CLOSED);
      onChange?.(CLOSED);
      return;
    }
    const visual = window.visualViewport;
    if (!visual) return;
    let baselines: ViewportBaselines = new Map();
    const update = () => {
      const result = readKeyboardViewport(baselines, {
        width: window.innerWidth, innerHeight: window.innerHeight,
        visualHeight: visual.height, editableFocused: editableFocused(),
      });
      baselines = result.baselines;
      setViewport(result.viewport);
      onChange?.(result.viewport);
      if (result.viewport.clampHeight !== null) window.scrollTo(0, 0);
    };
    update();
    visual.addEventListener('resize', update);
    visual.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('focusin', update);
    window.addEventListener('focusout', update);
    return () => {
      visual.removeEventListener('resize', update);
      visual.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('focusin', update);
      window.removeEventListener('focusout', update);
    };
  }, [enabled, onChange]);
  return viewport;
}
