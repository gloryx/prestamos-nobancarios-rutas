import type { ReactElement, RefObject } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type TableActionIcon } from './layout/Icon';

export type TableAction = {
  key: string;
  icon: TableActionIcon;
  label: string;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  buttonRef?: RefObject<HTMLButtonElement | null>;
  onClick?: () => void;
  to?: string;
};

export function TableActions({ actions, ariaLabel }: { actions: TableAction[]; ariaLabel?: string }): ReactElement {
  return <div className="icon-actions" aria-label={ariaLabel}>
    {actions.map((action) => action.to
      ? <Link key={action.key} to={action.to} title={action.title} aria-label={action.ariaLabel}><Icon name={action.icon} /></Link>
      : <button key={action.key} ref={action.buttonRef} type="button" title={action.title} aria-label={action.ariaLabel} disabled={action.disabled} onClick={action.onClick}><Icon name={action.icon} /></button>)}
  </div>;
}
