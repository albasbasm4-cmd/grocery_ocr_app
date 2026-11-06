import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { useAuth } from './AuthContext';
import type { Customer, DiscountType, PaymentMethod, Product } from '../types';

export interface CartItem {
  product: Product;
  quantity: string;
}

interface CartContextValue {
  items: CartItem[];
  discountType: DiscountType;
  discountValue: string;
  paymentMethod: PaymentMethod;
  selectedCustomer: Customer | null;
  subtotal: string;
  discountAmount: string;
  totalAmount: string;
  totalItemCount: string;
  addItem: (product: Product, quantityToAdd?: string) => { success: boolean; error?: string };
  updateItemQuantity: (productId: string, quantity: string) => { success: boolean; error?: string };
  removeItem: (productId: string) => void;
  clearCart: () => void;
  setDiscountType: (type: DiscountType) => void;
  setDiscountValue: (val: string) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setSelectedCustomer: (customer: Customer | null) => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth() as any;
  const activeStore = auth.store || auth.currentStore;
  const storeId = activeStore?.id;

  const storageKey = storeId ? `grocery_cart_${storeId}` : null;

  const [items, setItems] = useState<CartItem[]>(() => {
    if (!storageKey) return [];
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.items)) return parsed.items;
      }
    } catch {
      // ignore parsing error
    }
    return [];
  });

  const [discountType, setDiscountType] = useState<DiscountType>('fixed');
  const [discountValue, setDiscountValue] = useState<string>('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // استرجاع السلة المحفوظة عند تغيير المتجر
  useEffect(() => {
    if (!storageKey) {
      setItems([]);
      return;
    }
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.items)) setItems(parsed.items);
        if (parsed.discountType) setDiscountType(parsed.discountType);
        if (parsed.discountValue) setDiscountValue(parsed.discountValue);
        if (parsed.paymentMethod) setPaymentMethod(parsed.paymentMethod);
        if (parsed.selectedCustomer) setSelectedCustomer(parsed.selectedCustomer);
      }
    } catch {
      // ignore
    }
  }, [storageKey]);

  // حفظ السلة تلقائياً عند أي تعديل
  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          items,
          discountType,
          discountValue,
          paymentMethod,
          selectedCustomer,
        })
      );
    } catch {
      // ignore storage error
    }
  }, [storageKey, items, discountType, discountValue, paymentMethod, selectedCustomer]);

  const addItem = (product: Product, quantityToAdd = '1') => {
    if (!product.is_active) {
      return { success: false, error: `المنتج "${product.name}" معطّل حالياً ولا يمكن بيعه.` };
    }

    const availableStock = new Decimal(product.stock_quantity || '0');
    if (availableStock.lessThanOrEqualTo(0)) {
      return { success: false, error: `المنتج "${product.name}" نفد من المخزون تماماً.` };
    }

    const addDec = new Decimal(quantityToAdd || '1');
    if (!addDec.isFinite() || addDec.lessThanOrEqualTo(0)) {
      return { success: false, error: 'الكمية المضافة غير صالحة.' };
    }

    const existingIndex = items.findIndex((i) => i.product.id === product.id);
    let targetQty = addDec;

    if (existingIndex >= 0 && items[existingIndex]) {
      const currentQty = new Decimal(items[existingIndex]!.quantity || '0');
      targetQty = currentQty.plus(addDec);
    }

    if (targetQty.greaterThan(availableStock)) {
      return {
        success: false,
        error: `الكمية المطلوبة (${targetQty}) تتجاوز المخزون المتوفر (${availableStock}) للمنتج "${product.name}".`,
      };
    }

    setItems((prev) => {
      if (existingIndex >= 0 && prev[existingIndex]) {
        const copy = [...prev];
        copy[existingIndex] = {
          product: copy[existingIndex]!.product,
          quantity: targetQty.toString(),
        };
        return copy;
      }
      return [...prev, { product, quantity: targetQty.toString() }];
    });

    return { success: true };
  };

  const updateItemQuantity = (productId: string, quantityStr: string) => {
    const item = items.find((i) => i.product.id === productId);
    if (!item) return { success: false, error: 'المنتج غير موجود في السلة.' };

    const trimmed = quantityStr.trim();
    if (trimmed === '' || trimmed === '0') {
      removeItem(productId);
      return { success: true };
    }

    let qtyDec: Decimal;
    try {
      qtyDec = new Decimal(trimmed);
    } catch {
      return { success: false, error: 'الكمية المدخلة غير صحيحة.' };
    }

    if (!qtyDec.isFinite() || qtyDec.lessThan(0)) {
      return { success: false, error: 'الكمية يجب أن تكون أكبر من الصفر.' };
    }

    const availableStock = new Decimal(item.product.stock_quantity || '0');
    if (qtyDec.greaterThan(availableStock)) {
      return {
        success: false,
        error: `الكمية المطلوبة (${qtyDec}) تتجاوز المخزون المتوفر (${availableStock}) للمنتج "${item.product.name}".`,
      };
    }

    setItems((prev) =>
      prev.map((i) => (i.product.id === productId ? { ...i, quantity: qtyDec.toString() } : i))
    );

    return { success: true };
  };

  const removeItem = (productId: string) => {
    setItems((prev) => prev.filter((i) => i.product.id !== productId));
  };

  const clearCart = () => {
    setItems([]);
    setDiscountValue('0');
    setPaymentMethod('cash');
    setSelectedCustomer(null);
    if (storageKey) {
      localStorage.removeItem(storageKey);
    }
  };

  // الحسابات المالية الدقيقة باستخدام Decimal.js
  const { subtotal, discountAmount, totalAmount, totalItemCount } = useMemo(() => {
    let subtotalDec = new Decimal(0);
    let countDec = new Decimal(0);

    for (const item of items) {
      try {
        const q = new Decimal(item.quantity || '0');
        const p = new Decimal(item.product.price || '0');
        if (q.isFinite() && p.isFinite() && q.greaterThan(0)) {
          subtotalDec = subtotalDec.plus(q.times(p));
          countDec = countDec.plus(q);
        }
      } catch {
        // ignore
      }
    }

    let discAmountDec = new Decimal(0);
    try {
      const discInput = new Decimal(discountValue || '0');
      if (discInput.isFinite() && discInput.greaterThan(0)) {
        if (discountType === 'percentage') {
          // نسبة مئوية مقربة لأقرب فلس
          discAmountDec = subtotalDec.times(discInput).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        } else {
          discAmountDec = discInput;
        }
      }
    } catch {
      // ignore
    }

    // التحقق ألا يتجاوز الخصم الإجمالي الفرعي
    if (discAmountDec.greaterThan(subtotalDec)) {
      discAmountDec = subtotalDec;
    }

    const totalDec = subtotalDec.minus(discAmountDec);

    return {
      subtotal: subtotalDec.toFixed(2),
      discountAmount: discAmountDec.toFixed(2),
      totalAmount: totalDec.toFixed(2),
      totalItemCount: countDec.toString(),
    };
  }, [items, discountType, discountValue]);

  return (
    <CartContext.Provider
      value={{
        items,
        discountType,
        discountValue,
        paymentMethod,
        selectedCustomer,
        subtotal,
        discountAmount,
        totalAmount,
        totalItemCount,
        addItem,
        updateItemQuantity,
        removeItem,
        clearCart,
        setDiscountType,
        setDiscountValue,
        setPaymentMethod,
        setSelectedCustomer,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
};
