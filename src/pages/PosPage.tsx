import { useState } from 'react';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { ar } from '../i18n/ar';
import type { Product } from '../types';
import { lookupProductsByCode } from '../services/barcodeLookupService';
import { ScanLine, ShoppingBasket } from 'lucide-react';

interface CartLine { product: Product; quantity: number }

export default function PosPage() {
  const { store } = useAuth();
  const { formatCurrency, formatNumber } = useSettings();
  const { showToast } = useToast();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [choices, setChoices] = useState<Product[]>([]);

  const addProduct = (product: Product) => {
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      return existing ? current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { product, quantity: 1 }];
    });
    setChoices([]);
  };

  const handleCode = async (code: string) => {
    if (!store) return;
    try {
      const found = await lookupProductsByCode(store.id, code);
      if (!found.length) { showToast(ar.codeNotFound, 'error'); return; }
      if (found.length === 1) addProduct(found[0]!);
      else setChoices(found);
    } catch (error) { showToast(error instanceof Error ? error.message : ar.genericError, 'error'); }
  };

  const submitManual = () => {
    const code = manualCode.trim();
    if (!code) return;
    void handleCode(code);
    setManualCode('');
  };

  const total = cart.reduce((sum, line) => sum + Number(line.product.price) * line.quantity, 0);

  return <div className="space-y-4 pb-6" dir="rtl">
    <div className="flex items-center justify-between"><div><h1 className="text-xl font-extrabold text-white">{ar.navPos}</h1><p className="mt-1 text-xs text-slate-400">{ar.scanToAdd}</p></div><Button icon={<ScanLine className="h-4 w-4" />} onClick={() => setScannerOpen(true)}>{ar.scanProduct}</Button></div>
    <Card className="space-y-3 p-3"><label className="text-sm font-bold text-slate-200">{ar.manualBarcodeSku}<input className="field mt-2" dir="auto" value={manualCode} onChange={(event) => setManualCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submitManual(); } }} /></label><Button className="w-full" variant="outline" disabled={!manualCode.trim()} onClick={submitManual}>{ar.searchCode}</Button></Card>
    {choices.length > 0 && <Card className="space-y-2 p-3"><p className="font-bold text-white">{ar.chooseProduct}</p>{choices.map((product) => <button key={product.id} onClick={() => addProduct(product)} className="flex w-full items-center justify-between rounded-xl bg-slate-800 p-3 text-right"><span className="font-bold text-white">{product.name}</span><span className="text-sm text-slate-300">{formatCurrency(product.price, store?.currency_symbol || 'ر.س', 2)}</span></button>)}</Card>}
    {cart.length === 0 ? <EmptyState icon={<ShoppingBasket className="h-8 w-8" />} title={ar.cartEmpty} description={ar.scanToAdd} /> : <div className="space-y-2">{cart.map(({ product, quantity }) => <Card key={product.id} className="flex items-center justify-between gap-3 p-3"><div className="min-w-0"><p className="truncate font-bold text-white">{product.name}</p><p className="text-xs text-slate-400">{formatCurrency(product.price, store?.currency_symbol || 'ر.س', 2)} × {formatNumber(String(quantity), { decimals: 0 })}</p></div><Button size="sm" variant="outline" aria-label={ar.addOne} onClick={() => addProduct(product)}>+1</Button></Card>)}<Card className="flex items-center justify-between p-4"><span className="font-bold text-slate-200">{ar.total}</span><span className="text-lg font-extrabold text-emerald-300">{formatCurrency(total.toFixed(2), store?.currency_symbol || 'ر.س', 2)}</span></Card></div>}
    <BarcodeScanner isOpen={scannerOpen} storeId={store?.id || ''} onClose={() => setScannerOpen(false)} onCode={(code) => { void handleCode(code); }} onProduct={(product) => addProduct(product)} />
  </div>;
}
