import React from 'react';
import { toLatinDigits } from '../../lib/numbers';

export interface NumberInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'prefix'> {
  value: string | number;
  onChange: (value: string) => void;
  allowDecimals?: boolean;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  error?: string;
  label?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  allowDecimals = true,
  prefix,
  suffix,
  error,
  label,
  className = '',
  disabled,
  placeholder,
  ...props
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // تحويل الأرقام الهندية والعربية مباشرة إلى لاتينية
    const raw = e.target.value;
    const normalized = toLatinDigits(raw);

    // تصفية المحارف غير الرقمية
    let cleaned = '';
    let hasDot = false;
    for (const ch of normalized) {
      if (ch >= '0' && ch <= '9') {
        cleaned += ch;
      } else if (allowDecimals && ch === '.' && !hasDot) {
        cleaned += '.';
        hasDot = true;
      }
    }
    onChange(cleaned);
  };

  return (
    <div className="w-full">
      {label && <label className="block text-xs font-semibold text-slate-300 mb-1.5">{label}</label>}
      <div
        className={`flex items-center rounded-xl border bg-slate-950 px-3.5 transition ${
          error
            ? 'border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20'
            : 'border-slate-700 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-400/20'
        } ${disabled ? 'opacity-60 bg-slate-900' : ''}`}
      >
        {prefix && <span className="text-slate-400 text-sm pl-2 shrink-0">{prefix}</span>}
        <input
          type="text"
          inputMode={allowDecimals ? 'decimal' : 'numeric'}
          value={value ?? ''}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`w-full py-3 bg-transparent text-white text-base outline-none text-right font-sans ${className}`}
          {...props}
        />
        {suffix && <span className="text-slate-400 text-sm pr-2 shrink-0">{suffix}</span>}
      </div>
      {error && <p className="mt-1 text-xs text-rose-400">{error}</p>}
    </div>
  );
};
