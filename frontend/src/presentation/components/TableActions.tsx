import type { ReactElement } from 'react';
import { Icon, type TableActionIcon } from './layout/Icon';

export type TableAction = {
  key: string;
  icon: TableActionIcon;
  label: string;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick?: () => void;
};

export function TableActions({ actions, ariaLabel }: { actions: TableAction[]; ariaLabel?: string }): ReactElement {
  return <div className="icon-actions" aria-label={ariaLabel}>
    {actions.map((action) => <button key={action.key} type="button" title={action.title} aria-label={action.ariaLabel} disabled={action.disabled} onClick={action.onClick}><Icon name={action.icon} /></button>)}
  </div>;
}
