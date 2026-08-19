/**
 * Adds a copy button to every code block, working on a detached `<template>` so the live DOM
 * is never touched. Input is already DOMPurify output; assigning it to an inert template
 * neither executes script nor fetches subresources.
 *
 * Ported verbatim from `packages/renderer/src/app/shared/markdown/markdown-viewer.component.ts`.
 * The button goes *inside* the `<pre>` deliberately: the click handler finds the code with
 * `button.closest('pre')`, so a button placed after the `<pre>` makes every copy write the
 * empty string. The Angular spec has a dedicated test for that, and it is ported too.
 *
 * `<button>` is one of the tags `render-markdown.ts` forbids in model output, which is why
 * the affordance is injected here rather than being something a model could ask for.
 */

/** The class the click handler keys on. Exported so nothing has to retype the string. */
export const COPY_BUTTON_CLASS = 'code-copy-btn';

export function addCopyButtons(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  for (const pre of Array.from(template.content.querySelectorAll('pre'))) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = COPY_BUTTON_CLASS;
    button.textContent = 'Copy';
    pre.appendChild(button);
  }
  return template.innerHTML;
}
