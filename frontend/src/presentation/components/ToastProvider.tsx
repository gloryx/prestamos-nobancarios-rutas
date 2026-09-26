import { useCallback, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ToastContext } from "./ToastContext";

type ToastKind = "success" | "error";
type Toast = { id: number; kind: ToastKind; message: string };

export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const addToast = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4500);
  }, []);
  const value = {
    toast: {
      success: (message: string) => addToast("success", message),
      error: (message: string) => addToast("error", message),
    },
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-label="Notificaciones" aria-live="polite">
        {toasts.map((item) => (
          <div
            className={`toast toast--${item.kind}`}
            key={item.id}
            role={item.kind === "error" ? "alert" : "status"}
            aria-live={item.kind === "error" ? "assertive" : "polite"}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
