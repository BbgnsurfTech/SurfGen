'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface MobileNavContextValue {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

const MobileNavContext = createContext<MobileNavContextValue | null>(null);

/** Coordinates the sidebar drawer between Topbar (trigger) and Sidebar (drawer) below the lg breakpoint. */
export function MobileNavProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <MobileNavContext.Provider value={{ open, toggle: () => setOpen((value) => !value), close: () => setOpen(false) }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav(): MobileNavContextValue {
  const context = useContext(MobileNavContext);
  if (!context) throw new Error('useMobileNav must be used within MobileNavProvider');
  return context;
}
