import React, { useState } from 'react';
import { Tag, ChevronDown, ChevronUp } from 'lucide-react';
import Decimal from 'decimal.js';
import { useCart } from '../../contexts/CartContext';
import { ar } from '../../i18n/ar';
import { formatCurrencyDisplay, toLatinDigits } from '../../lib/numbers';

interface DiscountSectionProps {
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
}

export const DiscountSection: React.FC<DiscountSectionProps> = ({ currencySymbol, numberFormat }) => {
  const { discountType, discountValue, setDiscountType, setDiscountValue, subtotal, discountAmount } = useCart();
  const [isOpen, setIsOpen] = useState(false);

  const hasDiscount = Number(discountAmount) > 0;

  const handleInputChange = (val: string) => {
    const raw = toLatinDigits(val);
    let cleaned = '';
    let hasDot = false;
    for (const ch of raw) {
      if (ch >= '0' && ch <= '9') {
        cleaned += ch;
      } else if (ch === '.' && !hasDot) {
        cleaned += '.';
        hasDot = true;
      }
    }
    setDiscountValue(cleaned);
  };

  const isExceeded = React.useMemo(() => {
    try {
      const sub = new Decimal(subtotal || '0');
      const val = new Decimal(discountValue || '0');
      if (discountType === 'percentage') {
        return val.greaterThan(100);
      }
      return val.greaterThan(sub);
    } catch {
      return false;
    }
  }, [subtotal, discountValue, discountType]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden transition-all">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-3.5 flex items-center justify-between text-right hover:bg-slate-800/40 transition"
      >
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-semibold text-slate-200">{ar.discount}</span>
          {hasDiscount && (
            <span className="text-xs bg-rose-500/20 text-rose-300 px-2 py-0.5 rounded-full font-bold">
              -{formatCurrencyDisplay(discountAmount, currencySymbol, numberFormat)}
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {isOpen && (
        <div className="p-3.5 pt-0 border-t border-slate-800/80 space-y-3 mt-2">
          {/* خيارات نوع الخصم */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setDiscountType('fixed')}
              className={`py-1.5 text-xs font-bold rounded-lg transition ${
                discountType === 'fixed'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {ar.discountFixed} ({currencySymbol})
            </button>
            <button
              type="button"
              onClick={() => setDiscountType('percentage')}
              className={`py-1.5 text-xs font-bold rounded-lg transition ${
                discountType === 'percentage'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {ar.discountPercentage}
            </button>
          </div>

          {/* حقل إدخال قيمة الخصم */}
          <div>
            <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl px-3 focus-within:border-emerald-500 transition">
              <input
                type="text"
                inputMode="decimal"
                value={discountValue === '0' ? '' : discountValue}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="0"
                className="w-full py-2 bg-transparent text-white font-bold text-sm text-right outline-none"
              />
              <span className="text-xs text-slate-400 font-bold shrink-0 mr-2">
                {discountType === 'percentage' ? '%' : currencySymbol}
              </span>
            </div>

            {isExceeded && (
              <p className="text-[11px] text-rose-400 mt-1 font-medium">
                {discountType === 'percentage'
                  ? ar.discountExceeds100
                  : ar.discountExceedsSubtotal}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
