"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type ToastTone = "success" | "info";

type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  durationMs?: number;
};

type Toast = Required<Omit<ToastInput, "description">> & {
  id: number;
  description?: string;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function getToastClassName(tone: ToastTone) {
  if (tone === "success") {
    return "border-emerald-300/30 bg-[#07111f]/95 text-white shadow-emerald-950/30";
  }

  return "border-sky-300/25 bg-[#07111f]/95 text-white shadow-sky-950/30";
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback((toast: ToastInput) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);

    setToasts((current) => [
      ...current,
      {
        id,
        title: toast.title,
        description: toast.description,
        tone: toast.tone ?? "success",
        durationMs: toast.durationMs ?? 3200,
      },
    ]);
  }, []);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed inset-x-3 top-3 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);

    return () => window.clearTimeout(timeout);
  }, [onDismiss, toast.durationMs, toast.id]);

  return (
    <div
      role="status"
      className={`pointer-events-auto w-full max-w-sm rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur transition ${getToastClassName(
        toast.tone,
      )}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black">{toast.title}</p>
          {toast.description ? (
            <p className="mt-1 text-slate-300">{toast.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="rounded-full px-2 text-lg leading-none text-slate-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}
