import { ImportProductsModal } from '../components/products/ImportProductsModal';
import { ExportProductsModal } from '../components/products/ExportProductsModal';
import { Upload, Download } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ChevronDown, Eye, FolderTree, PackagePlus, Pencil, Search, SlidersHorizontal, Warehouse } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { PinPromptModal } from '../components/PinPromptModal';
import { ProductDetailModal } from '../components/products/ProductDetailModal';
import { ProductForm } from '../components/products/ProductForm';
import { StockAdjustmentModal } from '../components/products/StockAdjustmentModal';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { useDebounce } from '../hooks/useDebounce';
import { compareArabic, sortArabic } from '../lib/arabic';
import Decimal from 'decimal.js';
import { useSettings } from '../contexts/SettingsContext';
import { toLatinDigits } from '../lib/numbers';
import { ensureOnlineWithToast } from '../lib/offlineGuard';
import { ar } from '../i18n/ar';
import { fetchCategories } from '../services/categoriesService';
import { adjustProductStockRpc, createProduct, fetchProductCosts, fetchProducts, setProductActive, updateProduct, type ProductInput } from '../services/productsService';
import type { Category, Product } from '../types';
import { Link } from 'react-router-dom';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { lookupProductsByCode } from '../services/barcodeLookupService';
import { ScanLine } from 'lucide-react';

const PAGE_SIZE = 40;

type FilterType = 'all' | 'low_stock' | 'expiring_soon' | 'inactive';

function filterLabel(filter: FilterType): string {
  if (filter === 'low_stock') return ar.filterLowStock;
  if (filter === 'expiring_soon') return ar.filterExpiring;
  if (filter === 'inactive') return ar.filterInactive;
  return ar.filterAll;
}

export default function ProductsPage() {
  const { store, role } = useAuth();
  const { formatNumber, formatCurrency } = useSettings();
  const { isOwner } = usePermissions();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 250);
  const [categoryId, setCategoryId] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [formOpen, setFormOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | (() => Promise<void>)>(null);
  const [pendingStock, setPendingStock] = useState<{ product: Product; quantity: string; reason: string } | null>(null);
  const [formDraft, setFormDraft] = useState<ProductInput | null>(null);
  const [actionProduct, setActionProduct] = useState<Product | null>(null);
  const [nextActiveState, setNextActiveState] = useState<boolean | null>(null);
  const observerRef = useRef<HTMLDivElement | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['categories', store?.id],
    queryFn: () => fetchCategories(store!.id),
    enabled: Boolean(store?.id),
    staleTime: 30_000,
  });
  const categories = categoriesQuery.data || [];
  const productsQuery = useInfiniteQuery({
    queryKey: ['products', store?.id, categoryId, filter, debouncedSearch],
    queryFn: async ({ pageParam }) => {
      const result = await fetchProducts(store!.id, {
      categoryId: categoryId || null,
      filterType: filter,
      searchQuery: debouncedSearch,
      page: pageParam,
      pageSize: PAGE_SIZE,
      });
      if (!isOwner || !result.products.length) return result;
      const costs = await fetchProductCosts(store!.id, result.products.map((product) => product.id));
      return { ...result, products: result.products.map((product) => ({ ...product, cost_price: costs.get(product.id) ?? '0' })) };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => lastPage.hasMore ? allPages.length : undefined,
    enabled: Boolean(store?.id),
    staleTime: 20_000,
  });
  const products = useMemo(() => productsQuery.data?.pages.flatMap((page) => page.products) || [], [productsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (input: ProductInput) => createProduct(store!.id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products', store?.id] });
      showToast(ar.createProductSuccess, 'success');
    },
  });
  const updateMutation = useMutation({
    mutationFn: ({ product, input }: { product: Product; input: ProductInput }) => updateProduct(product.id, store!.id, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products', store?.id] });
      showToast(ar.updateProductSuccess, 'success');
    },
  });
  const activeMutation = useMutation({
    mutationFn: ({ product, isActive }: { product: Product; isActive: boolean }) => setProductActive(product.id, isActive),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['products', store?.id] });
      showToast(variables.isActive ? ar.activateProduct : ar.deactivateProduct, 'success');
    },
  });
  const stockMutation = useMutation({
    mutationFn: ({ product, quantity, reason }: { product: Product; quantity: string; reason: string }) => adjustProductStockRpc(product.id, quantity, reason),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products', store?.id] });
      await queryClient.invalidateQueries({ queryKey: ['product-movements'] });
      showToast(ar.adjustStockSuccess, 'success');
    },
  });

  const openCreate = () => {
    if (!ensureOnlineWithToast('إضافة منتج جديد', showToast)) return;
    setEditingProduct(null);
    setFormOpen(true);
  };
  const openEdit = (product: Product) => {
    if (!ensureOnlineWithToast('تعديل بيانات المنتج وسعر البيع', showToast)) return;
    setEditingProduct(product);
    setFormOpen(true);
  };
  const onProductSubmit = async (input: ProductInput) => {
    setFormDraft(input);
    setPinOpen(true);
  };
  const confirmProductSubmit = async () => {
    if (!formDraft) return;
    if (editingProduct) await updateMutation.mutateAsync({ product: editingProduct, input: formDraft });
    else await createMutation.mutateAsync(formDraft);
    setFormDraft(null);
    setFormOpen(false);
    setEditingProduct(null);
  };
  const requestProductStateChange = (product: Product) => {
    if (!ensureOnlineWithToast('تعطيل أو تفعيل المنتج', showToast)) return;
    setActionProduct(product);
    setNextActiveState(!product.is_active);
    setPinOpen(true);
  };
  const requestStockAdjustment = (product: Product) => {
    if (!ensureOnlineWithToast('تسوية المخزون يدوياً', showToast)) return;
    setStockProduct(product);
  };
  const loadMore = productsQuery.hasNextPage && !productsQuery.isFetchingNextPage;

  useEffect(() => {
    if (!loadMore || !observerRef.current) return;
    const node = observerRef.current;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void productsQuery.fetchNextPage();
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, productsQuery.fetchNextPage]);

  const onPinSuccess = async () => {
    try {
      if (formDraft) await confirmProductSubmit();
      else if (actionProduct && nextActiveState !== null) {
        await activeMutation.mutateAsync({ product: actionProduct, isActive: nextActiveState });
        setActionProduct(null);
        setNextActiveState(null);
      } else if (pendingStock) {
        await stockMutation.mutateAsync(pendingStock);
        setPendingStock(null);
        setStockProduct(null);
      } else if (pendingAction) await pendingAction();
    } catch (error) {
      showToast(error instanceof Error ? error.message : ar.genericError, 'error');
    }
  };

  const groupedProducts = useMemo(() => {
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    const groups = new Map<string, { category: Category | null; products: Product[] }>();
    for (const product of products) {
      const groupKey = product.category_id || '__uncategorized__';
      const existing = groups.get(groupKey);
      if (existing) existing.products.push(product);
      else groups.set(groupKey, { category: categoryById.get(groupKey) || null, products: [product] });
    }
    return [...groups.entries()]
      .map(([key, group]) => ({ key, ...group, products: sortArabic(group.products, (product) => product.name) }))
      .sort((a, b) => compareArabic(a.category?.name || ar.allCategories, b.category?.name || ar.allCategories));
  }, [products, categories]);

  const canSeeCost = role === 'owner';

  return (
    <div className="space-y-4 pb-4" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">{ar.productsTitle}</h1>
          <p className="mt-1 text-xs text-slate-400">{products.length}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              icon={<Upload className="h-4 w-4" />}
              onClick={() => setImportOpen(true)}
            >
              <span className="hidden sm:inline">{ar.importProducts}</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            icon={<Download className="h-4 w-4" />}
            onClick={() => setExportOpen(true)}
          >
            <span className="hidden sm:inline">{ar.exportProducts}</span>
          </Button>
          {isOwner && (
            <Link
              to="/categories"
              aria-label={ar.manageCategories}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-700 px-3 text-xs font-bold text-slate-200"
            >
              <FolderTree className="h-4 w-4" />
              <span className="hidden md:inline">{ar.manageCategories}</span>
            </Link>
          )}
          <Button variant="outline" size="sm" icon={<ScanLine className="h-4 w-4" />} onClick={() => setScannerOpen(true)}>
            {ar.scanProduct}
          </Button>
          {isOwner && (
            <Button size="sm" icon={<PackagePlus className="h-4 w-4" />} onClick={openCreate}>
              {ar.addNewProduct}
            </Button>
          )}
        </div>
      </div>

      <Card className="space-y-3 p-3">
        <label className="relative block">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input className="field pr-10" value={search} onChange={(event) => setSearch(toLatinDigits(event.target.value))} placeholder={ar.searchPlaceholder} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="relative">
            <span className="sr-only">{ar.category}</span>
            <select className="field appearance-none pl-8" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              <option value="">{ar.allCategories}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </label>
          <label className="relative">
            <SlidersHorizontal className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <select className="field pr-10" value={filter} onChange={(event) => setFilter(event.target.value as FilterType)}>
              {(['all', 'low_stock', 'expiring_soon', ...(isOwner ? ['inactive'] : [])] as FilterType[]).map((item) => <option key={item} value={item}>{filterLabel(item)}</option>)}
            </select>
          </label>
        </div>
      </Card>

      {productsQuery.isLoading ? <LoadingSpinner message={ar.loading} /> : productsQuery.isError ? <ErrorState title={ar.genericError} message={productsQuery.error.message} /> : products.length === 0 ? <EmptyState icon={<Warehouse className="h-8 w-8" />} title={ar.noProductsFound} description={ar.noProducts} /> : (
        <div className="space-y-5">
          {groupedProducts.map((group) => (
            <section key={group.key} className="space-y-2">
              <h2 className="sticky top-14 z-10 rounded-xl bg-slate-950/95 px-2 py-1.5 text-sm font-extrabold text-emerald-300 backdrop-blur">{group.category?.name || ar.allCategories} <span className="font-normal text-slate-500">({group.products.length})</span></h2>
              {group.products.map((product) => (
                <Card key={product.id} className="space-y-3 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <button className="min-w-0 flex-1 text-right" onClick={() => setDetailProduct(product)}>
                      <span className="block truncate font-bold text-white">{product.name}</span>
                      <span className="mt-1 block text-xs text-slate-500">{product.barcode ? `${ar.barcode}: ${product.barcode}` : product.sku_small_text ? `SKU: ${product.sku_small_text}` : product.category_id ? group.category?.name : ar.noCategories}</span>
                    </button>
                    <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ${new Decimal(product.stock_quantity).lessThanOrEqualTo(product.min_stock) ? 'bg-amber-500/10 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>{formatNumber(product.stock_quantity, { decimals: 3 })} {product.unit}</span>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-emerald-300">{ar.sellingPrice}: {formatCurrency(product.price, store?.currency_symbol || 'ر.س', 2)}</p>
                      {canSeeCost && <p className="mt-1 text-xs text-slate-500">{ar.costPrice}: {formatCurrency(product.cost_price, store?.currency_symbol || 'ر.س', 2)}</p>}
                      {!product.is_active && <span className="mt-1 inline-block rounded-md bg-slate-700 px-2 py-0.5 text-[10px] text-slate-300">{ar.inactive}</span>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button className="touch-target rounded-lg p-2 text-slate-400 hover:bg-slate-800" onClick={() => setDetailProduct(product)} aria-label={ar.productDetails}><Eye className="h-4 w-4" /></button>
                      {isOwner && <>
                        <button className="touch-target rounded-lg p-2 text-slate-400 hover:bg-slate-800" onClick={() => openEdit(product)} aria-label={ar.editProduct}><Pencil className="h-4 w-4" /></button>
                        <button className="touch-target rounded-lg p-2 text-amber-300 hover:bg-slate-800" onClick={() => requestStockAdjustment(product)} aria-label={ar.adjustStock}><Warehouse className="h-4 w-4" /></button>
                        <button className="touch-target rounded-lg p-2 text-rose-300 hover:bg-slate-800" onClick={() => requestProductStateChange(product)} aria-label={product.is_active ? ar.deactivateProduct : ar.activateProduct}><Archive className="h-4 w-4" /></button>
                      </>}
                    </div>
                  </div>
                  {product.expiry_date && <p className="text-xs text-amber-300">{ar.expiryDate}: {product.expiry_date}</p>}
                </Card>
              ))}
            </section>
          ))}
          <div ref={observerRef} className="h-8 text-center text-xs text-slate-500">{productsQuery.isFetchingNextPage ? ar.loadingMore : productsQuery.hasNextPage ? '' : ar.endOfResults}</div>
          {productsQuery.hasNextPage && <Button className="w-full" variant="outline" isLoading={productsQuery.isFetchingNextPage} onClick={() => void productsQuery.fetchNextPage()}>{ar.loadingMore}</Button>}
        </div>
      )}

      <BarcodeScanner isOpen={scannerOpen} storeId={store?.id || ''} onClose={() => setScannerOpen(false)} onCode={(code) => {
        void lookupProductsByCode(store?.id || '', code).then((found) => {
          if (found.length === 1) setDetailProduct(found[0]!);
          else if (found.length > 1) showToast(ar.chooseProduct, 'info');
          else if (isOwner) { setFormOpen(true); setEditingProduct(null); setScannedBarcode(code); }
          else showToast(ar.codeNotFoundStaff, 'error');
        }).catch((error: unknown) => showToast(error instanceof Error ? error.message : ar.genericError, 'error'));
      }} onProduct={(product) => setDetailProduct(product)} />
      <ProductForm isOpen={formOpen} onClose={() => { setFormOpen(false); setEditingProduct(null); setScannedBarcode(''); }} onSubmit={onProductSubmit} categories={categories} product={editingProduct} isSaving={createMutation.isPending || updateMutation.isPending} canSeeCost={canSeeCost} storeId={store?.id || ''} initialBarcode={scannedBarcode} />
      <ProductDetailModal product={detailProduct} isOpen={Boolean(detailProduct)} onClose={() => setDetailProduct(null)} canSeeCost={canSeeCost} />
      <StockAdjustmentModal product={stockProduct} isOpen={Boolean(stockProduct)} onClose={() => setStockProduct(null)} isSaving={stockMutation.isPending} onSubmit={async (quantity, reason) => {
        if (!stockProduct) return;
        setPendingStock({ product: stockProduct, quantity, reason });
        setPinOpen(true);
      }} />
      <PinPromptModal isOpen={pinOpen} onClose={() => { setPinOpen(false); setFormDraft(null); setActionProduct(null); setNextActiveState(null); setPendingAction(null); setPendingStock(null); }} onSuccess={onPinSuccess} />

      {isOwner && (
        <ImportProductsModal
          isOpen={importOpen}
          onClose={() => setImportOpen(false)}
          storeId={store?.id || ''}
          onSuccess={() => {
            void queryClient.invalidateQueries({ queryKey: ['products'] });
            showToast('تم استيراد المنتجات بنجاح.', 'success');
          }}
        />
      )}

      <ExportProductsModal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        storeId={store?.id || ''}
        storeName={store?.name || 'store'}
        initialCategoryId={categoryId || null}
        categories={categories}
      />
    </div>
  );
}
