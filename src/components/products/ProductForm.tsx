import Decimal from 'decimal.js';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { ar } from '../../i18n/ar';
import type { Product, ProductUnit } from '../../types';
import type { ProductInput } from '../../services/productsService';
import type { Category } from '../../types';

interface ProductFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: ProductInput) => Promise<void>;
  categories: Category[];
  product?: Product | null;
  isSaving?: boolean;
  canSeeCost: boolean;
}

const UNIT_OPTIONS: Array<{ value: ProductUnit; label: string }> = [
  { value: 'piece', label: ar.unitPiece },
  { value: 'kg', label: ar.unitKg },
  { value: 'g', label: ar.unitG },
  { value: 'carton', label: ar.unitCarton },
  { value: 'pack', label: ar.unitPack },
  { value: 'box', label: ar.unitBox },
  { value: 'other', label: ar.unitOther },
];

export function ProductForm({ isOpen, onClose, onSubmit, categories, product, isSaving, canSeeCost }: ProductFormProps) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState<ProductUnit>('piece');
  const [price, setPrice] = useState('0');
  const [cost, setCost] = useState('0');
  const [stock, setStock] = useState('0');
  const [minStock, setMinStock] = useState('0');
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(product?.name ?? '');
    setCategoryId(product?.category_id ?? '');
    setBarcode(product?.barcode ?? '');
    setSku(product?.sku_small_text ?? '');
    setUnit(product?.unit ?? 'piece');
    setPrice(product?.price ?? '0');
    setCost(product?.cost_price ?? '0');
    setStock(product?.stock_quantity ?? '0');
    setMinStock(product?.min_stock ?? '0');
    setExpiry(product?.expiry_date ?? '');
    setError('');
  }, [isOpen, product]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError(ar.productNameRequired); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(price) || !new Decimal(price).isFinite() || new Decimal(price).isNegative()) { setError(ar.priceMustBeNonNegative); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(cost) || !new Decimal(cost).isFinite() || new Decimal(cost).isNegative()) { setError(ar.priceMustBeNonNegative); return; }
    if (!/^\d+(\.\d{1,3})?$/.test(stock) || !new Decimal(stock).isFinite() || new Decimal(stock).isNegative()) { setError(ar.stockInvalid); return; }
    if (!/^\d+(\.\d{1,3})?$/.test(minStock) || !new Decimal(minStock).isFinite() || new Decimal(minStock).isNegative()) { setError(ar.stockInvalid); return; }

    try {
      await onSubmit({
        name: name.trim(),
        category_id: categoryId || null,
        barcode: barcode.trim() || null,
        sku_small_text: sku.trim() || null,
        unit,
        price,
        cost_price: cost,
        stock_quantity: product ? undefined : stock,
        min_stock: minStock,
        expiry_date: expiry || null,
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : ar.genericError);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={product ? ar.editProduct : ar.addNewProduct} maxWidth="lg">
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-sm font-semibold text-slate-300">{ar.productName}
          <input className="field mt-2" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="block text-sm font-semibold text-slate-300">{ar.category}
          <select className="field mt-2" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{ar.allCategories}</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-300">{ar.barcode}
            <input className="field mt-2 font-sans" dir="ltr" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-slate-300">{ar.skuSmallText}
            <input className="field mt-2 font-sans" dir="ltr" value={sku} onChange={(e) => setSku(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm font-semibold text-slate-300">{ar.unit}
          <select className="field mt-2" value={unit} onChange={(e) => setUnit(e.target.value as ProductUnit)}>
            {UNIT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberInput label={ar.sellingPrice} value={price} onChange={setPrice} allowDecimals prefix={undefined} />
          {canSeeCost && <NumberInput label={ar.costPrice} value={cost} onChange={setCost} allowDecimals />}
        </div>
        {!product && <NumberInput label={ar.stockQuantity} value={stock} onChange={setStock} allowDecimals />}
        <NumberInput label={ar.minStock} value={minStock} onChange={setMinStock} allowDecimals />
        <label className="block text-sm font-semibold text-slate-300">{ar.expiryDate}
          <input type="date" className="field mt-2 font-sans" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </label>
        {error && <p role="alert" className="rounded-xl bg-rose-500/10 p-3 text-sm text-rose-300">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button type="submit" className="flex-1" isLoading={isSaving}>{ar.save}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{ar.cancel}</Button>
        </div>
      </form>
    </Modal>
  );
}
