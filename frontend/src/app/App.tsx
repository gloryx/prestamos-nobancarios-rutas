import type { ReactElement } from 'react';
import { ToastProvider } from '../presentation/components/ToastProvider';
import { AppRouter } from '../presentation/routes/AppRouter';

export function App(): ReactElement {
  return (
    <ToastProvider>
      <AppRouter />
    </ToastProvider>
  );
}
