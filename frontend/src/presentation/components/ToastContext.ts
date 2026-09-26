import { createContext, useContext } from "react";

export type ToastContextValue = { toast: { success: (message: string) => void; error: (message: string) => void } };

export const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside ToastProvider");
  return context;
}
