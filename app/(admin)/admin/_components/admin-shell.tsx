"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Sidebar on tablets and up (md ≥ 768 px); below that a top bar with a menu button opens the same
 * navigation as a drawer. The drawer closes when a link is followed, on Escape and on the backdrop.
 */
export function AdminShell({
  aside,
  brand,
  labels,
  children,
}: {
  aside: ReactNode;
  brand: ReactNode;
  labels: { open: string; close: string };
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const iconBtn =
    "grid h-11 w-11 flex-none place-items-center rounded-md text-[#E9E2E3] hover:bg-[#2A2224]";
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <header className="sticky top-0 z-30 flex items-center gap-1 bg-[#1F1718] px-2 py-1 text-[#E9E2E3] md:hidden">
        <button
          type="button"
          aria-label={labels.open}
          aria-expanded={open}
          aria-controls="admin-nav"
          onClick={() => setOpen(true)}
          className={iconBtn}
        >
          <MenuIcon />
        </button>
        {brand}
      </header>
      {open ? (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      ) : null}
      <aside
        id="admin-nav"
        onClick={(e) => {
          // Following a link closes the drawer.
          if (e.target instanceof Element && e.target.closest("a")) setOpen(false);
        }}
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] max-w-[85vw] flex-col gap-0.5 overflow-y-auto bg-[#1F1718] px-2.5 py-3.5 text-[#E9E2E3] transition-transform md:static md:w-[210px] md:max-w-none md:flex-none md:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full max-md:invisible"}`}
      >
        <div className="mb-2 flex items-center gap-2 border-b border-[#3A2F31] px-2 pt-1 pb-3.5">
          {brand}
          <button
            type="button"
            aria-label={labels.close}
            onClick={() => setOpen(false)}
            className={`${iconBtn} ml-auto md:hidden`}
          >
            <CloseIcon />
          </button>
        </div>
        {aside}
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 px-3 py-3 md:px-6 md:py-4">
        {children}
      </main>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg
      aria-hidden
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
