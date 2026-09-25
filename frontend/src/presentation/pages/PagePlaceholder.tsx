import type { ReactElement } from 'react';

type PagePlaceholderProps = { title: string; subtitle: string };

export function PagePlaceholder({ title, subtitle }: PagePlaceholderProps): ReactElement {
  return <section className="page-placeholder" aria-labelledby="page-title"><h2 id="page-title">{title}</h2><p>{subtitle}</p></section>;
}
