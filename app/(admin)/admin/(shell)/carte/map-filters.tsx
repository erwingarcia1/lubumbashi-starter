"use client";

import { useRef, type ReactNode } from "react";

/**
 * GET filter form that applies as soon as a select changes with the mouse. A change made with the
 * keyboard (arrow keys step through the options and fire `change` at every step on Windows/Linux)
 * waits for Entrée or for the field to be left, so keyboard users are not reloaded at each step.
 * The "Rechercher" button stays for no-JS.
 */
export function MapFilters({ children, className }: { children: ReactNode; className?: string }) {
  const keyboard = useRef(false);
  const pending = useRef(false);
  const isSelect = (el: EventTarget | null) => el instanceof HTMLSelectElement;
  return (
    <form
      method="get"
      className={className}
      onMouseDown={() => {
        keyboard.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && isSelect(e.target)) {
          e.preventDefault();
          pending.current = false;
          e.currentTarget.requestSubmit();
          return;
        }
        keyboard.current = true;
      }}
      onChange={(e) => {
        if (!isSelect(e.target)) return;
        if (keyboard.current) {
          pending.current = true;
          return;
        }
        e.currentTarget.requestSubmit();
      }}
      onBlur={(e) => {
        if (pending.current && isSelect(e.target)) {
          pending.current = false;
          e.currentTarget.requestSubmit();
        }
      }}
    >
      {children}
    </form>
  );
}
