import * as XLSX from 'xlsx';
import Decimal from 'decimal.js';
import { supabase } from '../lib/supabase';
import { toLatinDigits } from '../lib/numbers';
import { normalizeArabic } from '../lib/arabic';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { fetchProductCosts } from './productsService';
import { createCategory } from './categoriesService';

export const TEMPLATE_COLUMNS = [
  'الاسم',
  'التصنيف',
  'الباركود',
  'الرقم الصغير SKU',
  'الوحدة',
  'سعر البيع',
  'سعر الشراء',
  'الكمية',
  'الحد الأدنى',
  'تاريخ الصلاحية',
] as const;

export interface ColumnMapping {
  name: number;
  category: number;
  barcode: number;
  sku: number;
  unit: number;
  price: number;
  cost_price: number;
  stock_quantity: number;
  min_stock: number;
  expiry_date: number;
}

export interface ValidatedRow {
  rowIndex: number;
  isValid: boolean;
  error?: string;
  data: {
    name: string;
    category_name: string;
    category_id?: string;
    barcode: string;
    sku_small_text: string;
    unit: string;
    price: string;
    cost_price: string;
    stock_quantity: string;
    min_stock: string;
    expiry_date: string;
  };
}

export interface ValidationSummary {
  totalRows: number;
  validRows: ValidatedRow[];
  invalidRows: ValidatedRow[];
  duplicateBarcodesInFile: string[];
  uniqueCategoriesInFile: string[];
  newCategoriesToCreate: string[];
}

export interface BulkUpsertResult {
  accepted_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  rejected_count: number;
  rejections: Array<{
    row_index?: number;
    name?: string;
    barcode?: string;
    reason: string;
  }>;
}

export interface BatchProgress {
  currentBatch: number;
  totalBatches: number;
  processedRows: number;
  totalRows: number;
  percent: number;
}

// -----------------------------------------------------------------------------
// 1. إنشاء وتحميل قالب Excel المعتمد
// -----------------------------------------------------------------------------
export function generateTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const headers = [...TEMPLATE_COLUMNS];
  const sampleRows = [
    [
      'حليب المراعي كامل الدسم 1 لتر',
      'ألبان',
      '6281007001111',
      '10101',
      'حبة',
      6.5,
      4.8,
      24,
      6,
      '2026-12-31',
    ],
    [
      'تفاح أحمر سكري',
      'فواكه',
      '2000000000012',
      '10202',
      'كيلو',
      8.5,
      5.75,
      15.5,
      5.0,
      '',
    ],
    [
      'سكر الأسرة ناعم 5 كجم',
      'معلبات ومؤن',
      '6281014002222',
      '10303',
      'كيس',
      22.0,
      18.0,
      10,
      2,
      '2028-06-30',
    ],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);

  // ضبط عروض الأعمدة لتكون مريحة عند القراءة
  ws['!cols'] = [
    { wch: 30 }, // الاسم
    { wch: 16 }, // التصنيف
    { wch: 18 }, // الباركود
    { wch: 18 }, // SKU
    { wch: 12 }, // الوحدة
    { wch: 14 }, // سعر البيع
    { wch: 14 }, // سعر الشراء
    { wch: 12 }, // الكمية
    { wch: 12 }, // الحد الأدنى
    { wch: 16 }, // الصلاحية
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'قالب المنتجات');
  return wb;
}

export async function downloadTemplate(): Promise<void> {
  const wb = generateTemplateWorkbook();
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const fileName = 'قالب_استيراد_منتجات_البقالة.xlsx';

  if (Capacitor.isNativePlatform()) {
    const base64Data = arrayBufferToBase64(wbout);
    const saved = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
    });
    await Share.share({
      title: 'قالب استيراد المنتجات',
      url: saved.uri,
    });
  } else {
    triggerBrowserDownload(blob, fileName);
  }
}

// -----------------------------------------------------------------------------
// 2. تحليل ملف الاستيراد عبر Web Worker مع خيار احتياطي
// -----------------------------------------------------------------------------
export async function parseImportFile(
  file: File
): Promise<{ headers: string[]; rows: string[][]; totalRows: number }> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const fileType: 'xlsx' | 'csv' = ext === 'csv' ? 'csv' : 'xlsx';

  const fileBuffer = await file.arrayBuffer();

  // محاولة التحليل عبر Web Worker لمنع تجميد الشاشة في الملفات الضخمة
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL('../workers/importParserWorker.ts', import.meta.url),
          { type: 'module' }
        );

        const timeoutId = setTimeout(() => {
          worker.terminate();
          reject(new Error('استغرق تحليل الملف وقتاً أطول من المتوقع.'));
        }, 30000);

        worker.onmessage = (e) => {
          clearTimeout(timeoutId);
          worker.terminate();
          if (e.data.success) {
            resolve({
              headers: e.data.headers,
              rows: e.data.rows,
              totalRows: e.data.totalRows,
            });
          } else {
            reject(new Error(e.data.error || 'فشل تحليل الملف.'));
          }
        };

        worker.onerror = (err) => {
          clearTimeout(timeoutId);
          worker.terminate();
          reject(err);
        };

        worker.postMessage({
          type: 'PARSE_FILE',
          fileBuffer,
          fileName: file.name,
          fileType,
        });
      });
    } catch (workerErr) {
      console.warn('Worker parsing failed or unavailable, falling back to main thread:', workerErr);
    }
  }

  // المعالجة الاحتياطية في المسار الرئيسي
  return parseInMainThread(fileBuffer, fileType);
}

function parseInMainThread(
  buffer: ArrayBuffer,
  fileType: 'xlsx' | 'csv'
): { headers: string[]; rows: string[][]; totalRows: number } {
  let workbook: XLSX.WorkBook;

  if (fileType === 'csv') {
    const decoder = new TextDecoder('utf-8');
    let text = decoder.decode(buffer);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    workbook = XLSX.read(text, { type: 'string', raw: true });
  } else {
    workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('الملف فارغ ولا يحتوي على أي ورقة عمل.');
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) throw new Error('تعذر قراءة الورقة الأولى من الملف.');

  const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false,
  });

  if (!rawRows || rawRows.length === 0) {
    throw new Error('الملف لا يحتوي على أي صفوف أو بيانات.');
  }

  const headers = (rawRows[0] || []).map((h) => String(h || '').trim());
  const dataRows = rawRows
    .slice(1)
    .map((row) => (row || []).map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some((cell) => cell !== ''));

  return {
    headers,
    rows: dataRows,
    totalRows: dataRows.length,
  };
}

// -----------------------------------------------------------------------------
// 3. التحديد التلقائي لربط الأعمدة باللغة العربية والإنجليزية
// -----------------------------------------------------------------------------
export function autoMapHeaders(headers: string[]): ColumnMapping {
  const norm = (str: string) => normalizeArabic(str.toLowerCase()).replace(/[^a-z0-9]/g, '');

  const findIdx = (keywords: string[]): number => {
    const normKeywords = keywords.map(norm);
    for (let i = 0; i < headers.length; i++) {
      const h = norm(headers[i] || '');
      if (normKeywords.some((k) => h === k || h.includes(k) || k.includes(h))) {
        return i;
      }
    }
    return -1;
  };

  return {
    name: findIdx(['الاسم', 'اسم المنتج', 'اسم الصنف', 'المنتج', 'name', 'productname', 'itemname', 'title']),
    category: findIdx(['التصنيف', 'الفئة', 'القسم', 'المجموعة', 'category', 'categoryname', 'group', 'section']),
    barcode: findIdx(['الباركود', 'باركود', 'كود', 'الرمز', 'barcode', 'barcode', 'upc', 'ean', 'code']),
    sku: findIdx(['الرقم الصغير', 'الرقم الصغير sku', 'sku', 'skusmalltext', 'رمز sku', 'رمز صنف']),
    unit: findIdx(['الوحدة', 'وحدة القياس', 'وحدة', 'unit', 'uom', 'measure']),
    price: findIdx(['سعر البيع', 'السعر', 'سعر', 'price', 'saleprice', 'sellingprice']),
    cost_price: findIdx(['سعر الشراء', 'سعر التكلفة', 'التكلفة', 'تكلفة', 'cost', 'costprice', 'purchaseprice']),
    stock_quantity: findIdx(['الكمية', 'المخزون', 'الرصيد', 'كمية', 'stock', 'quantity', 'stockquantity', 'qty']),
    min_stock: findIdx(['الحد الأدنى', 'حد الطلب', 'الحد الادنى للمخزون', 'minstock', 'minimumstock', 'minqty']),
    expiry_date: findIdx(['تاريخ الصلاحية', 'انتهاء الصلاحية', 'الصلاحية', 'تاريخ الانتهاء', 'expiry', 'expirydate', 'expirationdate']),
  };
}

// -----------------------------------------------------------------------------
// 4. التحقق الشامل من الصفوف قبل الإرسال (Client-side validation)
// -----------------------------------------------------------------------------
export function validateImportRows(
  rows: string[][],
  mapping: ColumnMapping,
  existingCategoryNames: string[]
): ValidationSummary {
  const validRows: ValidatedRow[] = [];
  const invalidRows: ValidatedRow[] = [];

  const barcodeCounts = new Map<string, number[]>();
  const uniqueCategoriesSet = new Set<string>();

  const existingNormCategories = new Set(
    existingCategoryNames.map((n) => normalizeArabic(n.trim()))
  );

  rows.forEach((rawRow, idx) => {
    const rowNum = idx + 2; // الصف الفعلي في ملف Excel بعد الترويسة

    const getCell = (colIdx: number): string => {
      if (colIdx < 0 || colIdx >= rawRow.length) return '';
      return (rawRow[colIdx] || '').trim();
    };

    const name = getCell(mapping.name);
    const categoryName = getCell(mapping.category);
    const rawBarcode = getCell(mapping.barcode);
    const barcode = toLatinDigits(rawBarcode).replace(/\s+/g, '');
    const sku = toLatinDigits(getCell(mapping.sku)).replace(/\s+/g, '');
    const unit = getCell(mapping.unit) || 'حبة';

    const rawPrice = toLatinDigits(getCell(mapping.price)).replace(/,/g, '.');
    const rawCost = toLatinDigits(getCell(mapping.cost_price)).replace(/,/g, '.');
    const rawStock = toLatinDigits(getCell(mapping.stock_quantity)).replace(/,/g, '.');
    const rawMinStock = toLatinDigits(getCell(mapping.min_stock)).replace(/,/g, '.');
    const rawExpiry = toLatinDigits(getCell(mapping.expiry_date)).trim();

    const errors: string[] = [];

    // التحقق من الحقول الإلزامية
    if (!name) {
      errors.push('اسم المنتج إلزامي ومفقود.');
    }

    // التحقق من سعر البيع
    let priceStr = '0.00';
    if (!rawPrice) {
      errors.push('سعر البيع إلزامي ومفقود.');
    } else {
      try {
        const p = new Decimal(rawPrice);
        if (p.isNegative() || p.isNaN()) {
          errors.push('سعر البيع يجب أن يكون رقماً غير سالب.');
        } else {
          priceStr = p.toFixed(2);
        }
      } catch {
        errors.push('صيغة سعر البيع غير صالحة.');
      }
    }

    // التحقق من سعر الشراء (التكلفة)
    let costStr = '0.00';
    if (rawCost) {
      try {
        const c = new Decimal(rawCost);
        if (c.isNegative() || c.isNaN()) {
          errors.push('سعر الشراء لا يمكن أن يكون سالباً.');
        } else {
          costStr = c.toFixed(2);
        }
      } catch {
        errors.push('صيغة سعر الشراء غير صالحة.');
      }
    }

    // التحقق من الكمية
    let stockStr = '0.000';
    if (rawStock) {
      try {
        const s = new Decimal(rawStock);
        if (s.isNegative() || s.isNaN()) {
          errors.push('كمية المخزون لا يمكن أن تكون سالبة.');
        } else {
          stockStr = s.toFixed(3);
        }
      } catch {
        errors.push('صيغة كمية المخزون غير صالحة.');
      }
    }

    // التحقق من الحد الأدنى
    let minStockStr = '0.000';
    if (rawMinStock) {
      try {
        const ms = new Decimal(rawMinStock);
        if (ms.isNegative() || ms.isNaN()) {
          errors.push('الحد الأدنى للمخزون لا يمكن أن يكون سالباً.');
        } else {
          minStockStr = ms.toFixed(3);
        }
      } catch {
        errors.push('صيغة الحد الأدنى للمخزون غير صالحة.');
      }
    }

    // التحقق من تاريخ الصلاحية
    let expiryStr = '';
    if (rawExpiry) {
      const match = rawExpiry.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
      if (match && match[1] && match[2] && match[3]) {
        const y = match[1];
        const m = match[2].padStart(2, '0');
        const d = match[3].padStart(2, '0');
        expiryStr = `${y}-${m}-${d}`;
      } else {
        const d = new Date(rawExpiry);
        if (!isNaN(d.getTime())) {
          expiryStr = d.toISOString().split('T')[0] || '';
        } else {
          errors.push('صيغة تاريخ الصلاحية غير صالحة (الصيغة المطلوبة YYYY-MM-DD).');
        }
      }
    }

    // تتبع الباركودات لكشف التكرار داخل الملف
    if (barcode) {
      const list = barcodeCounts.get(barcode) || [];
      list.push(rowNum);
      barcodeCounts.set(barcode, list);
    }

    // تتبع التصنيفات
    if (categoryName) {
      uniqueCategoriesSet.add(categoryName);
    }

    const rowObj: ValidatedRow = {
      rowIndex: rowNum,
      isValid: errors.length === 0,
      error: errors.join(' | '),
      data: {
        name,
        category_name: categoryName,
        barcode,
        sku_small_text: sku,
        unit,
        price: priceStr,
        cost_price: costStr,
        stock_quantity: stockStr,
        min_stock: minStockStr,
        expiry_date: expiryStr,
      },
    };

    if (rowObj.isValid) {
      validRows.push(rowObj);
    } else {
      invalidRows.push(rowObj);
    }
  });

  // كشف تكرار الباركود داخل الملف نفسه
  const duplicateBarcodesInFile: string[] = [];
  barcodeCounts.forEach((rowsArr, bcode) => {
    if (rowsArr.length > 1) {
      duplicateBarcodesInFile.push(bcode);
      // تعليم الصفوف المكررة اللاحقة بالخطأ
      rowsArr.slice(1).forEach((dupRowNum) => {
        const validIdx = validRows.findIndex((r) => r.rowIndex === dupRowNum);
        if (validIdx >= 0) {
          const removed = validRows.splice(validIdx, 1)[0];
          if (removed) {
            removed.isValid = false;
            removed.error = (removed.error ? removed.error + ' | ' : '') + `تكرار الباركود (${bcode}) داخل الملف في الصفوف: ${rowsArr.join('، ')}.`;
            invalidRows.push(removed);
          }
        }
      });
    }
  });

  const uniqueCategoriesInFile = Array.from(uniqueCategoriesSet);
  const newCategoriesToCreate = uniqueCategoriesInFile.filter(
    (c) => !existingNormCategories.has(normalizeArabic(c.trim()))
  );

  return {
    totalRows: rows.length,
    validRows,
    invalidRows,
    duplicateBarcodesInFile,
    uniqueCategoriesInFile,
    newCategoriesToCreate,
  };
}

// -----------------------------------------------------------------------------
// 5. إنشاء التصنيفات الجديدة تلقائياً
// -----------------------------------------------------------------------------
export async function createMissingCategories(
  storeId: string,
  categoryNames: string[]
): Promise<Map<string, string>> {
  const nameToId = new Map<string, string>();

  for (const name of categoryNames) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    try {
      const cat = await createCategory(storeId, trimmed);
      nameToId.set(trimmed, cat.id);
      nameToId.set(normalizeArabic(trimmed), cat.id);
    } catch (err) {
      console.warn(`Category creation for "${trimmed}" skipped or exists:`, err);
    }
  }

  // جلب كافة التصنيفات الحالية للربط الشامل
  const { data } = await supabase
    .from('categories')
    .select('id, name, name_normalized')
    .eq('store_id', storeId);

  (data || []).forEach((c) => {
    nameToId.set(c.name, c.id);
    nameToId.set(c.name_normalized, c.id);
  });

  return nameToId;
}

// -----------------------------------------------------------------------------
// 6. الإرسال على دفعات (500 صف) مع شريط التقدم
// -----------------------------------------------------------------------------
export async function importInBatches(
  storeId: string,
  rows: ValidatedRow[],
  mode: 'skip' | 'update',
  onProgress?: (p: BatchProgress) => void
): Promise<BulkUpsertResult> {
  const BATCH_SIZE = 500;
  const totalRows = rows.length;
  const totalBatches = Math.max(1, Math.ceil(totalRows / BATCH_SIZE));

  let totalAccepted = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalRejected = 0;
  const combinedRejections: BulkUpsertResult['rejections'] = [];

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const start = batchIdx * BATCH_SIZE;
    const end = Math.min(start + BATCH_SIZE, totalRows);
    const chunk = rows.slice(start, end).map((r) => ({
      name: r.data.name,
      category_id: r.data.category_id || null,
      category_name: r.data.category_name || null,
      barcode: r.data.barcode || null,
      sku_small_text: r.data.sku_small_text || null,
      unit: r.data.unit || 'piece',
      price: r.data.price,
      cost_price: r.data.cost_price,
      stock_quantity: r.data.stock_quantity,
      min_stock: r.data.min_stock,
      expiry_date: r.data.expiry_date || null,
    }));

    const { data, error } = await supabase.rpc('bulk_upsert_products', {
      p_store_id: storeId,
      p_rows: chunk,
      p_mode: mode,
    });

    if (error) {
      throw new Error(`خطأ في الدفعة ${batchIdx + 1}: ${error.message}`);
    }

    const res = data as BulkUpsertResult;
    totalAccepted += res.accepted_count || 0;
    totalInserted += res.inserted_count || 0;
    totalUpdated += res.updated_count || 0;
    totalSkipped += res.skipped_count || 0;
    totalRejected += res.rejected_count || 0;

    if (res.rejections && Array.isArray(res.rejections)) {
      res.rejections.forEach((rej) => {
        combinedRejections.push({
          row_index: (rej.row_index || 0) + start,
          name: rej.name || '',
          barcode: rej.barcode || '',
          reason: rej.reason || 'مرفوض',
        });
      });
    }

    if (onProgress) {
      onProgress({
        currentBatch: batchIdx + 1,
        totalBatches,
        processedRows: end,
        totalRows,
        percent: Math.round((end / totalRows) * 100),
      });
    }
  }

  return {
    accepted_count: totalAccepted,
    inserted_count: totalInserted,
    updated_count: totalUpdated,
    skipped_count: totalSkipped,
    rejected_count: totalRejected,
    rejections: combinedRejections,
  };
}

// -----------------------------------------------------------------------------
// 7. تنزيل ملف الصفوف المرفوضة مع سبب الرفض
// -----------------------------------------------------------------------------
export async function downloadRejectionsReport(
  rejections: Array<{ row_index?: number; name?: string; barcode?: string; reason: string }>
): Promise<void> {
  const wb = XLSX.utils.book_new();

  const headers = ['رقم الصف في الملف', 'اسم المنتج', 'الباركود', 'سبب الرفض'];
  const rows = rejections.map((r) => [
    r.row_index ?? '',
    r.name ?? '',
    r.barcode ?? '',
    r.reason ?? '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [{ wch: 16 }, { wch: 30 }, { wch: 20 }, { wch: 45 }];

  XLSX.utils.book_append_sheet(wb, ws, 'الصفوف المرفوضة');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  const fileName = `تقرير_المرفوضات_${new Date().toISOString().split('T')[0]}.xlsx`;

  if (Capacitor.isNativePlatform()) {
    const base64Data = arrayBufferToBase64(wbout);
    const saved = await Filesystem.writeFile({
      path: fileName,
      data: base64Data,
      directory: Directory.Cache,
    });
    await Share.share({
      title: 'تقرير الصفوف المرفوضة',
      url: saved.uri,
    });
  } else {
    triggerBrowserDownload(blob, fileName);
  }
}

// -----------------------------------------------------------------------------
// 8. تصدير المنتجات إلى Excel و CSV بنفس صيغة القالب
// -----------------------------------------------------------------------------
export async function exportProductsFile(
  storeId: string,
  storeName: string,
  categoryId: string | null,
  format: 'xlsx' | 'csv',
  isOwner: boolean
): Promise<void> {
  // 1. جلب المنتجات
  let query = supabase
    .from('products')
    .select(`
      id,
      name,
      barcode,
      sku_small_text,
      unit,
      price,
      cost_price,
      stock_quantity,
      min_stock,
      expiry_date,
      category_id,
      categories ( name )
    `)
    .eq('store_id', storeId)
    .order('name', { ascending: true });

  if (categoryId) {
    query = query.eq('category_id', categoryId);
  }

  const { data: products, error } = await query;
  if (error) throw new Error(`فشل جلب المنتجات للتصدير: ${error.message}`);

  if (!products || products.length === 0) {
    throw new Error('لا توجد منتجات لتصديرها.');
  }

  // 2. إذا كان مالكاً، استرجاع أسعار التكلفة عبر RPC الخاص بالتكلفة
  let costMap = new Map<string, string>();
  if (isOwner) {
    try {
      const productIds = products.map((p) => p.id);
      costMap = await fetchProductCosts(storeId, productIds);
    } catch (e) {
      console.warn('Could not fetch exact product costs for export:', e);
    }
  }

  // 3. بناء الصفوف بترتيب القالب
  const headers = [...TEMPLATE_COLUMNS];
  const rows = products.map((p) => {
    const catName = (p.categories as unknown as { name?: string } | null)?.name || '';
    const cost = isOwner ? costMap.get(p.id) || p.cost_price || '0.00' : '0.00';

    return [
      p.name,
      catName,
      p.barcode || '',
      p.sku_small_text || '',
      p.unit || 'حبة',
      p.price,
      cost,
      p.stock_quantity,
      p.min_stock,
      p.expiry_date || '',
    ];
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = [
    { wch: 30 },
    { wch: 18 },
    { wch: 18 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'المنتجات');

  const sanitizedStore = (storeName || 'store').replace(/[^a-zA-Z0-9_؀-ۿ]/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];

  if (format === 'csv') {
    // دعم UTF-8 مع BOM في ملفات CSV حتى تظهر الحروف العربية في Excel فوراً دون تشويه
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const csvWithBom = '\uFEFF' + csvContent;
    const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
    const fileName = `منتجات_${sanitizedStore}_${dateStr}.csv`;

    if (Capacitor.isNativePlatform()) {
      const saved = await Filesystem.writeFile({
        path: fileName,
        data: csvWithBom,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: 'تصدير المنتجات CSV',
        url: saved.uri,
      });
    } else {
      triggerBrowserDownload(blob, fileName);
    }
  } else {
    // بصيغة Excel .xlsx
    const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const fileName = `منتجات_${sanitizedStore}_${dateStr}.xlsx`;

    if (Capacitor.isNativePlatform()) {
      const base64Data = arrayBufferToBase64(wbout);
      const saved = await Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: Directory.Cache,
      });
      await Share.share({
        title: 'تصدير المنتجات Excel',
        url: saved.uri,
      });
    } else {
      triggerBrowserDownload(blob, fileName);
    }
  }
}

// -----------------------------------------------------------------------------
// 9. تصدير نسخة احتياطية كاملة بصيغة JSON (للمالك مع رمز PIN)
// -----------------------------------------------------------------------------
export async function exportFullStoreBackup(
  storeId: string,
  storeName: string
): Promise<void> {
  const { data, error } = await supabase.rpc('export_full_store_backup', {
    p_store_id: storeId,
  });

  if (error) {
    throw new Error(`فشل تصدير النسخة الاحتياطية: ${error.message}`);
  }

  const jsonString = JSON.stringify(data, null, 2);
  const sanitizedStore = (storeName || 'store').replace(/[^a-zA-Z0-9_؀-ۿ]/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];
  const fileName = `نسخة_احتياطية_${sanitizedStore}_${dateStr}.json`;

  if (Capacitor.isNativePlatform()) {
    const saved = await Filesystem.writeFile({
      path: fileName,
      data: jsonString,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: 'نسخة احتياطية كاملة للمتجر',
      url: saved.uri,
    });
  } else {
    const blob = new Blob([jsonString], { type: 'application/json' });
    triggerBrowserDownload(blob, fileName);
  }
}

// -----------------------------------------------------------------------------
// أدوات مساعدة للتنزيل والترميز
// -----------------------------------------------------------------------------
function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
