/** Native focus is the input owner; mounting an office never claims focus. */
export function acceptsOfficeKey(root: HTMLElement, event: KeyboardEvent): boolean {
  const target = event.target;
  return !event.defaultPrevented && !event.isComposing
    && target instanceof Element && root.contains(target)
    && root.contains(root.ownerDocument.activeElement)
    && !target.closest('input, textarea, select, form, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]')
    && !root.querySelector('[aria-modal="true"]');
}
