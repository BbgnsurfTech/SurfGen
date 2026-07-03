'use client';

import { CheckCircle2 } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState } from 'react';

const TOAST_DURATION_MS = 2200;

const ToastContext = createContext<(message: string) => void>(() => {});

/** Bottom-center toast, one at a time — matches the design's `flash()` behavior. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flash = useCallback((next: string) => {
    setMessage(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={flash}>
      {children}
      {message && (
        <div
          role="status"
          className="sg-fade fixed bottom-6 left-1/2 z-60 flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-ink px-5 py-3 text-[13px] font-semibold text-white shadow-[0_16px_40px_rgba(0,0,0,.3)]"
        >
          <CheckCircle2 className="size-4 text-camel" />
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}
