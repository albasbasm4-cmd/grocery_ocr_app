import * as XLSX from 'xlsx';
import Decimal from 'decimal.js';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import { supabase } from '../lib/supabase';
import { ar } from '../i18n/ar';

export interface DailySalesRow { day: string; invoice_count: number; revenue: string; average_invoice: string; discounts: string; }
export interface ProductReportRow { product_id: string | null; name: string; quantity_sold: string; revenue: string; }
export interface ProfitSummary { invoice_count: number; revenue: string; cost: string; profit: string; }
export interface ProfitProductRow { product_id: string | null; name: string; revenue: string; cost: string; profit: string; }
export interface LowStockRow { id: string; name: string; stock_quantity: string; min_stock: string; unit: string; category_name: string | null; }
export interface ExpiringRow { id: string; name: string; stock_quantity: string; unit: string; expiry_date: string; days_remaining: number; category_name: string | null; }
export interface InventoryCategoryRow { category_name: string; inventory_value: string; quantity: string; }
export interface DebtCustomer { id: string; name: string; phone: string | null; balance: string; }
export interface MovementRow { id: string; product_id: string; product_name: string; type: string; quantity_delta: string; reference_id: string | null; note: string | null; created_at: string; }
export interface ReportsPayload {
  sales_daily: DailySalesRow[];
  products_top: ProductReportRow[];
  products_slow: ProductReportRow[];
  profit_summary: ProfitSummary | null;
  profit_products: ProfitProductRow[] | null;
  profit_categories: ProfitProductRow[] | null;
  low_stock: LowStockRow[];
  expiring: ExpiringRow[];
  inventory_by_category: InventoryCategoryRow[] | null;
  debts: { total: string; customers: DebtCustomer[] };
  movements: MovementRow[];
}

export interface ReportFilter { from: string; to: string; expiryDays: number; productId: string | null; movementType: string | null; }

export async function fetchStoreReports(storeId: string, filter: ReportFilter): Promise<ReportsPayload> {
  const { data, error } = await supabase.rpc('get_store_reports', {
    p_store_id: storeId,
    p_from_date: filter.from,
    p_to_date: filter.to,
    p_expiry_days: filter.expiryDays,
    p_product_id: filter.productId,
    p_movement_type: filter.movementType,
  });
  if (error) throw error;
  return data as ReportsPayload;
}

export function exportReportsWorkbook(reports: ReportsPayload): Blob {
  const workbook = XLSX.utils.book_new();
  const append = (name: string, rows: unknown[]) => {
    if (rows.length > 0) XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  };
  append('المبيعات اليومية', reports.sales_daily.map((row) => ({ التاريخ: row.day, الفواتير: row.invoice_count, المبيعات: row.revenue, متوسط_الفاتورة: row.average_invoice, الخصومات: row.discounts })));
  append('الأكثر مبيعاً', reports.products_top.map((row) => ({ المنتج: row.name, الكمية: row.quantity_sold, الإيراد: row.revenue })));
  append('الأقل حركة', reports.products_slow.map((row) => ({ المنتج: row.name, الكمية: row.quantity_sold, الإيراد: row.revenue })));
  append('المخزون المنخفض', reports.low_stock.map((row) => ({ المنتج: row.name, التصنيف: row.category_name, الكمية: row.stock_quantity, الحد_الأدنى: row.min_stock, الوحدة: row.unit })));
  append('الصلاحية', reports.expiring.map((row) => ({ المنتج: row.name, التصنيف: row.category_name, الكمية: row.stock_quantity, تاريخ_الصلاحية: row.expiry_date, الأيام_المتبقية: row.days_remaining })));
  append('ديون العملاء', reports.debts.customers.map((row) => ({ العميل: row.name, الهاتف: row.phone, الرصيد: row.balance })));
  append('حركة المخزون', reports.movements.map((row) => ({ المنتج: row.product_name, النوع: row.type, التغير: row.quantity_delta, السبب: row.note, التاريخ: row.created_at })));
  if (reports.profit_summary) {
    append('ملخص الأرباح', [reports.profit_summary]);
    append('ربح المنتجات', (reports.profit_products ?? []).map((row) => ({ المنتج: row.name, الإيراد: row.revenue, التكلفة: row.cost, الربح: row.profit })));
    append('ربح التصنيفات', (reports.profit_categories ?? []).map((row) => ({ التصنيف: row.name, الإيراد: row.revenue, التكلفة: row.cost, الربح: row.profit })));
    append('قيمة المخزون', (reports.inventory_by_category ?? []).map((row) => ({ التصنيف: row.category_name, القيمة: row.inventory_value, الكمية: row.quantity })));
  }
  if (workbook.SheetNames.length === 0) append('التقارير', []);
  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportReportsCsv(reports: ReportsPayload): Blob {
  const rows = reports.sales_daily.map((row) => [row.day, row.invoice_count, row.revenue, row.average_invoice, row.discounts]);
  const csv = [`${ar.reports.csvDate},${ar.reports.csvInvoiceCount},${ar.reports.csvSales},${ar.reports.csvAverage},${ar.reports.csvDiscounts}`, ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n');
  return new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
}

function csvCell(value: string | number): string { return `"${String(value).replaceAll('"', '""')}"`; }

export async function shareReportPdf(reports: ReportsPayload, title: string): Promise<void> {
  const lines: string[] = [];
  const salesTotal = reports.sales_daily.reduce((total, row) => total.plus(row.revenue), new Decimal(0));
  const invoiceCount = reports.sales_daily.reduce((total, row) => total + Number(row.invoice_count), 0);
  lines.push(`إجمالي المبيعات: ${salesTotal.toFixed(2)} | الفواتير: ${invoiceCount}`);
  if (reports.profit_summary) {
    lines.push(`الإيراد: ${reports.profit_summary.revenue} | التكلفة: ${reports.profit_summary.cost} | الربح: ${reports.profit_summary.profit}`);
  }
  lines.push('المبيعات اليومية');
  reports.sales_daily.forEach((row) => lines.push(`${row.day} | ${row.invoice_count} فاتورة | ${row.revenue} | متوسط ${row.average_invoice}`));
  lines.push('الأكثر مبيعاً');
  reports.products_top.forEach((row) => lines.push(`${row.name} | كمية ${row.quantity_sold} | إيراد ${row.revenue}`));
  lines.push('الأقل حركة');
  reports.products_slow.forEach((row) => lines.push(`${row.name} | كمية ${row.quantity_sold}`));
  if (reports.profit_products) {
    lines.push('الأرباح حسب المنتج');
    reports.profit_products.forEach((row) => lines.push(`${row.name} | إيراد ${row.revenue} | تكلفة ${row.cost} | ربح ${row.profit}`));
    lines.push('الأرباح حسب التصنيف');
    (reports.profit_categories ?? []).forEach((row) => lines.push(`${row.name} | إيراد ${row.revenue} | تكلفة ${row.cost} | ربح ${row.profit}`));
    lines.push('قيمة المخزون حسب التصنيف');
    (reports.inventory_by_category ?? []).forEach((row) => lines.push(`${row.category_name} | ${row.inventory_value}`));
  }
  lines.push('المخزون المنخفض');
  reports.low_stock.forEach((row) => lines.push(`${row.name} | ${row.stock_quantity} من ${row.min_stock} | ${row.category_name ?? 'بدون تصنيف'}`));
  lines.push('قرب انتهاء الصلاحية');
  reports.expiring.forEach((row) => lines.push(`${row.name} | ${row.expiry_date} | ${row.days_remaining < 0 ? `منتهي منذ ${Math.abs(row.days_remaining)} يوم` : `باقي ${row.days_remaining} يوم`}`));
  lines.push(`إجمالي الديون: ${reports.debts.total}`);
  reports.debts.customers.forEach((row) => lines.push(`${row.name} | ${row.balance}`));
  lines.push('حركة المخزون');
  reports.movements.forEach((row) => lines.push(`${row.created_at} | ${row.product_name} | ${row.type} | ${row.quantity_delta} | ${row.note ?? ''}`));

  const canvas = document.createElement('canvas');
  const rowHeight = 38;
  canvas.width = 1400;
  canvas.height = Math.max(600, 190 + lines.length * rowHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر إعداد ملف PDF.');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 42px Cairo, sans-serif'; ctx.fillText(title, 1320, 68);
  ctx.font = '20px Cairo, sans-serif'; ctx.fillStyle = '#64748b';
  ctx.fillText(`الفترة: ${reports.sales_daily[0]?.day ?? '—'} إلى ${reports.sales_daily.at(-1)?.day ?? '—'}`, 1320, 112);
  let y = 166;
  for (const line of lines) {
    if (['المبيعات اليومية','الأكثر مبيعاً','الأقل حركة','الأرباح حسب المنتج','الأرباح حسب التصنيف','قيمة المخزون حسب التصنيف','المخزون المنخفض','قرب انتهاء الصلاحية','حركة المخزون'].includes(line)) {
      ctx.font = 'bold 23px Cairo, sans-serif'; ctx.fillStyle = '#047857';
    } else {
      ctx.font = '19px Cairo, sans-serif'; ctx.fillStyle = '#334155';
    }
    ctx.fillText(line, 1320, y, 1260);
    y += rowHeight;
  }
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pagePixelHeight = Math.floor((canvas.width * 297) / 210);
  const pageCount = Math.ceil(canvas.height / pagePixelHeight);
  for (let page = 0; page < pageCount; page += 1) {
    if (page > 0) pdf.addPage();
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = Math.min(pagePixelHeight, canvas.height - page * pagePixelHeight);
    const sliceContext = slice.getContext('2d');
    if (!sliceContext) throw new Error('تعذر تجهيز صفحات PDF.');
    sliceContext.drawImage(canvas, 0, page * pagePixelHeight, canvas.width, slice.height, 0, 0, slice.width, slice.height);
    const image = slice.toDataURL('image/jpeg', 0.92);
    const width = 210;
    const height = (slice.height * width) / slice.width;
    pdf.addImage(image, 'JPEG', 0, 0, width, height);
  }
  const blob = pdf.output('blob');
  const filename = `reports-${new Date().toISOString().slice(0, 10)}.pdf`;
  if (Capacitor.isNativePlatform()) {
    const base64 = await blobToBase64(blob);
    const file = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title, url: file.uri, dialogTitle: 'مشاركة التقرير' });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.share && typeof File !== 'undefined') {
    const file = new File([blob], filename, { type: 'application/pdf' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      await navigator.share({ title, files: [file] });
      return;
    }
  }
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('تعذر قراءة ملف PDF.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(blob);
  });
}
