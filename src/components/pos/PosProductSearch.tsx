import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Package } from 'lucide-react';
import { searchProducts } from '../../services/productsService';
import { useAuth } from '../../contexts/AuthContext';
import { formatCurrencyDisplay } from '../../lib/numbers';
import { ar } from '../../i18n/ar';
import type { Product } from '../../types';

interface PosProductSearchProps {
  onSelectProduct: (product: Product) => void;
  currencySymbol: string;
  numberFormat: 'latin' | 'arabic';
}

export const PosProductSearch: React.FC<PosProductSearchProps> = ({
  onSelectProduct,
  currencySymbol,
  numberFormat,
}) => {
  const auth = useAuth() as any;
  const activeStore = auth.store || auth.activeStore;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !activeStore) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const products = await searchProducts(activeStore.id, trimmed);
        setResults(products.filter((p: Product) => p.is_active));
        setIsOpen(true);
      } catch (err) {
        console.error('POS search error:', err);
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query, activeStore]);

  // إغلاق القائمة عند النقر خارجها
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePick = (p: Product) => {
    onSelectProduct(p);
    setQuery('');
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center bg-slate-900 border border-slate-800 focus-within:border-emerald-500 rounded-2xl px-3.5 py-2.5 transition">
        <Search className="w-4 h-4 text-slate-400 ml-2.5 shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ar.posQuickSearch}
          className="w-full bg-transparent text-sm text-white placeholder-slate-500 outline-none text-right"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
            }}
            className="p-1 text-slate-400 hover:text-white rounded-lg transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl max-h-64 overflow-y-auto z-40 p-1.5 divide-y divide-slate-800/80 animate-in fade-in">
          {loading ? (
            <p className="text-center text-xs text-slate-400 py-3">{ar.searching}</p>
          ) : results.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-400">
              {ar.noProductsFound}
            </div>
          ) : (
            results.map((product) => {
              const outOfStock = Number(product.stock_quantity) <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => handlePick(product)}
                  className={`w-full text-right p-2.5 rounded-xl flex items-center justify-between text-xs transition ${
                    outOfStock
                      ? 'opacity-50 cursor-not-allowed bg-slate-950/40'
                      : 'hover:bg-slate-800/80 active:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center shrink-0">
                      <Package className="w-3.5 h-3.5" />
                    </div>
                    <div>
                      <p className="font-bold text-slate-100">{product.name}</p>
                      <p className="text-[10px] text-slate-400">
                        {product.barcode ? ar.barcodePrefix(product.barcode) : ''}
                        {product.sku_small_text ? ` | SKU: ${product.sku_small_text}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="text-left shrink-0">
                    <p className="font-extrabold text-emerald-400">
                      {formatCurrencyDisplay(product.price, currencySymbol, numberFormat)}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {outOfStock ? (
                        <span className="text-rose-400">{ar.outOfStock}</span>
                      ) : (
                        ar.availableStockCount(product.stock_quantity)
                      )}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
