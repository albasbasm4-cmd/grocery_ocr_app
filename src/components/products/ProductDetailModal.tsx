import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Package, QrCode, Tag } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Card } from '../ui/Card';
import { ar } from '../../i18n/ar';
import { fetchProductMovements } from '../../services/productsService';
import type { Product, StockMovementType } from '../../types';
import { formatNumberDisplay } from '../../lib/numbers';
import { useSettings } from '../../contexts/SettingsContext';

interface ProductDetailModalProps {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  canSeeCost: boolean;
}

const movementLabel: Record<StockMovementType, string> = {
  sale: ar.stockMovementSale,
  return: ar.stockMovementReturn,
  purchase: ar.stockMovementPurchase,
  adjustment: ar.stockMovementAdjustment,
  damage: ar.stockMovementDamage,
  void: ar.stockMovementVoid,
};

export function ProductDetailModal({ product, isOpen, onClose, canSeeCost }: ProductDetailModalProps) {
  const { numberFormat } = useSettings();
  const movements = useQuery({
    queryKey: ['product-movements', product?.id],
    queryFn: () => fetchProductMovements(product!.id),
    enabled: Boolean(isOpen && product?.id),
  });
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.productDetails} maxWidth="lg">
      {product && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <h3 className="text-lg font-bold text-white">{product.name}</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p className="flex items-center gap-2 text-slate-300"><Package className="h-4 w-4 text-emerald-400" />{ar.stockQuantity}: {formatNumberDisplay(product.stock_quantity, numberFormat, { decimals: 3 })} {product.unit}</p>
              <p className="flex items-center gap-2 text-slate-300"><Tag className="h-4 w-4 text-emerald-400" />{ar.sellingPrice}: {formatNumberDisplay(product.price, numberFormat, { decimals: 2 })}</p>
              {canSeeCost && <p className="flex items-center gap-2 text-slate-300">{ar.costPrice}: {formatNumberDisplay(product.cost_price, numberFormat, { decimals: 2 })}</p>}
              {product.barcode && <p className="flex items-center gap-2 font-sans text-slate-300"><QrCode className="h-4 w-4 text-emerald-400" />{product.barcode}</p>}
              {product.sku_small_text && <p className="font-sans text-slate-300">SKU: {product.sku_small_text}</p>}
              {product.expiry_date && <p className="flex items-center gap-2 text-slate-300"><CalendarClock className="h-4 w-4 text-amber-400" />{ar.expiryDate}: {product.expiry_date}</p>}
            </div>
          </Card>
          <div>
            <h4 className="mb-2 font-bold text-white">{ar.productMovements}</h4>
            {movements.isLoading ? <p className="text-sm text-slate-400">{ar.loading}</p> : movements.isError ? <p className="text-sm text-rose-300">{movements.error.message}</p> : movements.data?.length ? (
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {movements.data.map((movement) => (
                  <Card key={movement.id} className="flex items-center justify-between gap-2 py-3 text-xs">
                    <div><p className="font-bold text-slate-100">{movementLabel[movement.type]}</p><p className="mt-1 text-slate-500">{new Date(movement.created_at).toLocaleString('ar')}</p>{movement.note && <p className="mt-1 text-slate-400">{movement.note}</p>}</div>
                    <span className={`font-mono font-bold ${Number(movement.quantity_delta) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{formatNumberDisplay(movement.quantity_delta, numberFormat, { decimals: 3 })}</span>
                  </Card>
                ))}
              </div>
            ) : <p className="text-sm text-slate-500">{ar.noMovements}</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
