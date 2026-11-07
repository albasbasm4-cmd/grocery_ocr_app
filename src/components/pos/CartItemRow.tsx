import React from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import Decimal from 'decimal.js';
import type { CartItem } from '../../contexts/CartContext';
import { formatCurrencyDisplay } from '../../lib/numbers';
import { ar } from '../../i18n/ar';
import { toLatinDigits } from '../../lib/numbers';

interface CartItemRowProps {
  item: CartItem;
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
  onUpdateQuantity: (qty: string) => void;
  onRemove: () => void;
}

export const CartItemRow: React.FC<CartItemRowProps> = ({
  item,
  currencySymbol,
  numberFormat,
  onUpdateQuantity,
  onRemove,
}) => {
  const isWeightUnit = item.product.unit === 'kg' || item.product.unit === 'g';

  const lineTotal = React.useMemo(() => {
    try {
      const q = new Decimal(item.quantity || '0');
      const p = new Decimal(item.product.price || '0');
      return q.times(p).toFixed(2);
    } catch {
      return '0.00';
    }
  }, [item.quantity, item.product.price]);

  const handleStep = (delta: number) => {
    try {
      const current = new Decimal(item.quantity || '0');
      const step = isWeightUnit ? new Decimal(0.5) : new Decimal(1);
      const next = delta > 0 ? current.plus(step) : current.minus(step);
      if (next.lessThanOrEqualTo(0)) {
        onRemove();
      } else {
        onUpdateQuantity(next.toString());
      }
    } catch {
      // ignore
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = toLatinDigits(e.target.value);
    // تنظيف المدخلات
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
    onUpdateQuantity(cleaned);
  };

  const unitLabel = (() => {
    switch (item.product.unit) {
      case 'kg': return ar.unitKg;
      case 'g': return ar.unitG;
      case 'carton': return ar.unitCarton;
      case 'pack': return ar.unitPack;
      case 'box': return ar.unitBox;
      default: return ar.unitPiece;
    }
  })();

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 flex flex-col gap-2.5 shadow-sm">
      {/* الصف العلوي: اسم المنتج، الوحدة، وسعر الوحدة وزر الحذف */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-slate-100 text-sm truncate">{item.product.name}</h4>
            <span className="text-[11px] font-medium bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full shrink-0">
              {unitLabel}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {ar.unitPriceDisplay(formatCurrencyDisplay(item.product.price, currencySymbol, numberFormat))}
          </p>
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition"
          aria-label={ar.removeItem}
          title={ar.removeItem}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* الصف السفلي: التحكم بالكمية والإجمالي الفرعي */}
      <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-800/60">
        {/* أزرار زيادة ونقصان وإدخال مباشر */}
        <div className="flex items-center bg-slate-950 border border-slate-800 rounded-xl p-1 gap-1">
          <button
            type="button"
            onClick={() => handleStep(-1)}
            className="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-lg active:scale-95 transition"
            aria-label={ar.decrease}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <input
            type="text"
            inputMode="decimal"
            value={item.quantity}
            onChange={handleInputChange}
            className="w-14 text-center bg-transparent text-white font-bold text-sm focus:outline-none"
            placeholder="1"
          />

          <button
            type="button"
            onClick={() => handleStep(1)}
            className="w-8 h-8 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 flex items-center justify-center font-bold text-lg active:scale-95 transition"
            aria-label={ar.increase}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* إجمالي البند */}
        <div className="text-left">
          <span className="text-[11px] text-slate-400 block">{ar.lineTotal}</span>
          <span className="text-base font-extrabold text-emerald-400">
            {formatCurrencyDisplay(lineTotal, currencySymbol, numberFormat)}
          </span>
        </div>
      </div>
    </div>
  );
};
