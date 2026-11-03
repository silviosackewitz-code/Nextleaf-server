import { ReactNode, useEffect, useId, useRef } from 'react';

export default function Dialog({ title, children, onClose, variant }: { title: string; children: ReactNode; onClose: () => void; variant?: 'editor' | 'drawer' }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    const element = dialog.current!;
    element.showModal();
    if (!variant) element.querySelector<HTMLInputElement>('input')?.focus();
    if (variant === 'editor') element.querySelector<HTMLButtonElement>('.mobileeditorbar button')?.focus();
    const viewport = window.visualViewport;
    const resize = () => {
      if (window.matchMedia('(max-width: 720px), (pointer: coarse) and (max-width: 1024px)').matches) {
        element.style.setProperty('--visible-height', `${viewport?.height ?? window.innerHeight}px`);
        element.style.setProperty('--visible-top', `${viewport?.offsetTop ?? 0}px`);
      }
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    return () => { viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize); element.close(); if (previousFocus instanceof HTMLElement) previousFocus.focus(); };
  }, []);
  return <dialog ref={dialog} className={`taskdialog ${variant ? `${variant}sheet` : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (variant !== 'drawer' || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <header className="detailheader">
      <h2 id={titleId} className="eyebrow">{title}</h2>
      <button className="iconbutton" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>×</button>
    </header>
    {children}
  </dialog>;
}
