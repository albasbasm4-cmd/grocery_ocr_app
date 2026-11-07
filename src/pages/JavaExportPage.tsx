import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ar } from '../i18n/ar';
import { supabase } from '../lib/supabase';
import {
  generateJavaSourceCode,
  downloadJavaFile,
  shareJavaCode,
  JavaProductInput,
} from '../services/javaExportService';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  FileCode2,
  Copy,
  Download,
  Share2,
  CheckCircle2,
  Sliders,
  PackageCheck,
  Code2,
} from 'lucide-react';

export default function JavaExportPage() {
  const { store } = useAuth();
  const { success, error } = useToast();

  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<JavaProductInput[]>([]);
  const [copied, setCopied] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  // إعدادات الكلاس والحزمة
  const [packageName, setPackageName] = useState('com.grocerypos');
  const [className, setClassName] = useState('ProductRepository');
  const [showOptions, setShowOptions] = useState(false);

  // جلب كل منتجات المتجر
  useEffect(() => {
    if (!store?.id) return;
    let active = true;

    async function fetchProducts() {
      try {
        setLoading(true);
        const pageSize = 1000;
        const allData: Array<{
          id: string; name: string; barcode: string | null; sku_small_text: string | null;
          unit: string; price: number; cost_price: number | null; stock_quantity: number;
          min_stock: number; expiry_date: string | null; categories: unknown;
        }> = [];
        for (let from = 0; ; from += pageSize) {
          const { data, error: fetchErr } = await supabase
            .from('products')
            .select('id, name, barcode, sku_small_text, unit, price, cost_price, stock_quantity, min_stock, expiry_date, categories(name)')
            .eq('store_id', store!.id)
            .order('name', { ascending: true })
            .range(from, from + pageSize - 1);
          if (fetchErr) throw fetchErr;
          allData.push(...(data ?? []) as typeof allData);
          if (!data || data.length < pageSize) break;
        }

        if (active) {
          const mapped: JavaProductInput[] = allData.map((item) => {
            const catObj = item.categories as { name?: string } | Array<{ name?: string }> | null;
            let catName: string | null = null;
            if (Array.isArray(catObj) && catObj.length > 0) {
              catName = catObj[0]?.name ?? null;
            } else if (catObj && typeof catObj === 'object' && 'name' in catObj) {
              catName = catObj.name ?? null;
            }

            return {
              id: item.id,
              name: item.name,
              barcode: item.barcode,
              sku_small_text: item.sku_small_text,
              category_name: catName,
              unit: item.unit,
              price: item.price,
              cost_price: item.cost_price,
              stock_quantity: item.stock_quantity,
              min_stock: item.min_stock,
              expiry_date: item.expiry_date,
            };
          });
          setProducts(mapped);
        }
      } catch (err: unknown) {
        console.error('Failed to fetch products for Java export:', err);
        error(ar.javaProductsLoadFailed);
      } finally {
        if (active) setLoading(false);
      }
    }

    void fetchProducts();

    return () => {
      active = false;
    };
  }, [store?.id]);

  // توليد الكود برمجياً بقالب ثابت
  const javaCode = useMemo(() => {
    return generateJavaSourceCode(products, {
      packageName: packageName.trim() || undefined,
      repositoryClassName: className.trim() || 'ProductRepository',
    });
  }, [products, packageName, className]);

  const lineCount = useMemo(() => {
    return javaCode.split('\n').length;
  }, [javaCode]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(javaCode);
      setCopied(true);
      success(ar.javaCodeCopied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      error(ar.javaCopyFailed);
    }
  };

  const handleDownload = () => {
    const fileName = `${className.trim() || 'ProductRepository'}.java`;
    downloadJavaFile(javaCode, fileName);
    success(ar.javaDownloadSuccess.replace('{file}', fileName));
  };

  const handleShare = async () => {
    setIsSharing(true);
    const fileName = `${className.trim() || 'ProductRepository'}.java`;
    try {
      await shareJavaCode(javaCode, fileName);
      success(ar.javaShareSuccess);
    } catch {
      // تم التعامل معه في الخدمة
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* البطاقة العلوية للمعلومات */}
      <Card className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950/40 border-indigo-500/20">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <FileCode2 className="w-5 h-5" />
            </div>
            <div>
              <CardTitle>{ar.javaExportTitle}</CardTitle>
              <p className="text-xs text-slate-400 mt-0.5">{ar.javaExportSubtitle}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-300 leading-relaxed">{ar.javaExportDesc}</p>

          <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/40 flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{ar.javaCompileSuccessNotice}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">{ar.javaTotalProducts}</span>
              <span className="font-bold text-white font-mono">{products.length}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
              <span className="text-slate-400">{ar.javaLinesCount}</span>
              <span className="font-bold text-emerald-400 font-mono">{lineCount}</span>
            </div>
          </div>

          {/* أزرار الإجراءات الرئيسية */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={handleCopy}
              icon={copied ? <CheckCircle2 className="w-4 h-4 text-emerald-200" /> : <Copy className="w-4 h-4" />}
            >
              <span>{copied ? ar.javaCopiedShort : ar.javaCopyCode}</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownload}
              icon={<Download className="w-4 h-4" />}
            >
              <span>{ar.javaDownloadFile}</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleShare()}
              isLoading={isSharing}
              icon={<Share2 className="w-4 h-4" />}
            >
              <span>{ar.javaShareFile}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* خيارات الحزمة والكلاس (قابلة للطي) */}
      <Card>
        <button
          type="button"
          onClick={() => setShowOptions((prev) => !prev)}
          className="w-full flex items-center justify-between p-3 text-xs font-bold text-slate-300 hover:text-white transition"
        >
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <span>{ar.javaPackageSettings}</span>
          </div>
          <span className="text-slate-500">{showOptions ? ar.hide : ar.edit}</span>
        </button>

        {showOptions && (
          <div className="p-3 pt-0 border-t border-slate-800 space-y-2 mt-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[11px] font-semibold text-slate-300">
                {ar.javaPackageName}
                <input
                  className="field mt-1 text-left font-mono text-xs"
                  dir="ltr"
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  placeholder="com.grocerypos"
                />
              </label>

              <label className="block text-[11px] font-semibold text-slate-300">
                {ar.javaClassName}
                <input
                  className="field mt-1 text-left font-mono text-xs"
                  dir="ltr"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  placeholder="ProductRepository"
                />
              </label>
            </div>
          </div>
        )}
      </Card>

      {/* نافذة معاينة الكود */}
      <Card className="overflow-hidden">
        <div className="bg-slate-900 px-3 py-2 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-slate-300 font-mono">
            <Code2 className="w-4 h-4 text-emerald-400" />
            <span>{className || 'ProductRepository'}.java</span>
          </div>
          <span className="text-[11px] text-slate-500">UTF-8 • Java 17+</span>
        </div>

        <div className="p-0 bg-slate-950 max-h-[420px] overflow-auto scrollbar-thin scrollbar-thumb-slate-800">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
              <PackageCheck className="w-6 h-6 animate-pulse text-indigo-400" />
              <span>{ar.javaLoadingProducts}</span>
            </div>
          ) : (
            <pre
              className="p-3.5 text-xs font-mono text-emerald-300/90 leading-relaxed overflow-x-auto selection:bg-emerald-800 selection:text-white"
              dir="ltr"
            >
              <code>{javaCode}</code>
            </pre>
          )}
        </div>
      </Card>
    </div>
  );
}
