import { useRef, type InputHTMLAttributes, type ReactElement, type ChangeEvent } from 'react';
import { formatMoneyInput, parseMoneyInput } from '../../shared/utils/money';

type MoneyInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: string;
  onChange: (rawValue: string) => void;
};

export function MoneyInput({ value, onChange, className, ...props }: MoneyInputProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const displayValue = formatMoneyInput(value);
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const beforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length);
    const digitPosition = (beforeCaret.match(/\d/g) ?? []).length;
    const parsed = parseMoneyInput(input.value);
    if (parsed.kind === 'invalid') return;
    onChange(parsed.raw);
    requestAnimationFrame(() => {
      const next = formatMoneyInput(parsed.raw);
      let position = 0;
      let digits = 0;
      while (position < next.length && digits < digitPosition) {
        if (/\d/.test(next[position])) digits += 1;
        position += 1;
      }
      inputRef.current?.setSelectionRange(position, position);
    });
  };
  return (
    <span className="money-input">
      <span className="money-input__prefix" aria-hidden="true">₡</span>
      <input {...props} ref={inputRef} type="text" inputMode="decimal" className={className} value={displayValue} onChange={handleChange} />
    </span>
  );
}
