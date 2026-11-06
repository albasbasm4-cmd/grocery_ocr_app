import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { jsPDF } from 'jspdf';
import type { PrintableReceipt } from '../types';

/**
 * رسم إيصال بيع حراري عالي الدقة (80mm) على Canvas
 * يدعم الخطوط العربية وتنسيق RTL والمحاذاة التلقائية
 */
export async function renderReceiptCanvas(receipt: PrintableReceipt): Promise<HTMLCanvasElement> {
  const width = 576; // عرض قياسي 80 مم عند 203 DPI
  const itemRowHeight = 44;
  const baseHeight = 360;
  const height = baseHeight + receipt.items.length * itemRowHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذر إنشاء سياق الرسم.');

  // خلفية بيضاء
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.direction = 'rtl';
  ctx.fillStyle = '#111827';

  let y = 42;

  // 1. عنوان المتجر
  ctx.font = 'bold 26px Cairo, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(receipt.storeName, width / 2, y);
  y += 28;

  ctx.font = '15px Cairo, sans-serif';
  ctx.fillStyle = '#4b5563';
  ctx.fillText('إيصال فاتورة مبيعات', width / 2, y);
  y += 24;

  ctx.font = '13px Cairo, sans-serif';
  ctx.fillText(`رقم الفاتورة: #${receipt.saleId.slice(0, 8).toUpperCase()}`, width / 2, y);
  y += 20;

  const dateStr = new Date(receipt.createdAt).toLocaleString('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  ctx.fillText(dateStr, width / 2, y);
  y += 20;

  if (receipt.customerName) {
    ctx.fillText(`العميل: ${receipt.customerName}`, width / 2, y);
    y += 20;
  }

  const payMethodText = receipt.paymentMethod === 'cash' ? 'نقداً' : 'آجل (ذمم)';
  ctx.fillText(`طريقة الدفع: ${payMethodText}`, width / 2, y);
  y += 18;

  // خط فاصل
  ctx.strokeStyle = '#9ca3af';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(24, y);
  ctx.lineTo(width - 24, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 22;

  // 2. ترويسة البنود
  ctx.font = 'bold 14px Cairo, sans-serif';
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'right';
  ctx.fillText('المنتج', width - 28, y);
  ctx.textAlign = 'center';
  ctx.fillText('الكمية', width / 2, y);
  ctx.textAlign = 'left';
  ctx.fillText('الإجمالي', 28, y);
  y += 14;

  ctx.strokeStyle = '#e5e7eb';
  ctx.beginPath();
  ctx.moveTo(24, y);
  ctx.lineTo(width - 24, y);
  ctx.stroke();
  y += 20;

  // 3. بنود الفاتورة
  ctx.font = '14px Cairo, sans-serif';
  for (const item of receipt.items) {
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'right';

    // قص الاسم الطويل إن زاد
    const displayName = item.name.length > 24 ? item.name.slice(0, 23) + '…' : item.name;
    ctx.fillText(displayName, width - 28, y);

    ctx.fillStyle = '#4b5563';
    ctx.textAlign = 'center';
    ctx.fillText(`${item.quantity} × ${item.unitPrice}`, width / 2, y);

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'left';
    ctx.fillText(`${item.lineTotal} ${receipt.currencySymbol}`, 28, y);

    y += itemRowHeight;
  }

  // خط فاصل
  ctx.strokeStyle = '#9ca3af';
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(24, y);
  ctx.lineTo(width - 24, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 24;

  // 4. ملخص الحسابات
  ctx.font = '15px Cairo, sans-serif';
  ctx.fillStyle = '#374151';

  // المجموع الفرعي
  ctx.textAlign = 'right';
  ctx.fillText('المجموع الفرعي:', width - 28, y);
  ctx.textAlign = 'left';
  ctx.fillText(`${receipt.subtotal} ${receipt.currencySymbol}`, 28, y);
  y += 24;

  // الخصم
  if (Number(receipt.discountAmount) > 0) {
    ctx.fillStyle = '#dc2626';
    ctx.textAlign = 'right';
    ctx.fillText('الخصم:', width - 28, y);
    ctx.textAlign = 'left';
    ctx.fillText(`-${receipt.discountAmount} ${receipt.currencySymbol}`, 28, y);
    y += 24;
  }

  // خط فاصل صلب
  ctx.strokeStyle = '#111827';
  ctx.beginPath();
  ctx.moveTo(24, y);
  ctx.lineTo(width - 24, y);
  ctx.stroke();
  y += 28;

  // الإجمالي الكلي بخط بارز
  ctx.font = 'bold 20px Cairo, sans-serif';
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'right';
  ctx.fillText('الإجمالي المطلوب:', width - 28, y);
  ctx.textAlign = 'left';
  ctx.fillText(`${receipt.totalAmount} ${receipt.currencySymbol}`, 28, y);
  y += 38;

  // 5. التذييل
  ctx.font = '14px Cairo, sans-serif';
  ctx.fillStyle = '#6b7280';
  ctx.textAlign = 'center';
  ctx.fillText('شكراً لتعاملكم معنا!', width / 2, y);
  y += 20;
  ctx.font = '12px Cairo, sans-serif';
  ctx.fillText('نظام بقالة POS', width / 2, y);

  return canvas;
}

export interface GeneratedPdfResult {
  blob: Blob;
  dataUrl: string;
  filename: string;
  base64: string;
}

/**
 * إنشاء ملف PDF أنيق بقياس 80 مم
 */
export async function generateReceiptPdf(receipt: PrintableReceipt): Promise<GeneratedPdfResult> {
  const canvas = await renderReceiptCanvas(receipt);
  const imgData = canvas.toDataURL('image/png');

  // تحويل الأبعاد إلى ملليمترات
  const mmWidth = 80;
  const mmHeight = Math.round((canvas.height * mmWidth) / canvas.width);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [mmWidth, mmHeight],
  });

  doc.addImage(imgData, 'PNG', 0, 0, mmWidth, mmHeight);

  const filename = `receipt-${receipt.saleId.slice(0, 8)}.pdf`;
  const pdfOutput = doc.output('datauristring');
  const base64Data = pdfOutput.split(',')[1] ?? '';
  const blob = doc.output('blob');

  return {
    blob,
    dataUrl: pdfOutput,
    filename,
    base64: base64Data,
  };
}

/**
 * مشاركة أو طباعة الإيصال عبر Capacitor Share أو تنزيل المتصفح
 */
export async function shareOrPrintReceipt(
  receipt: PrintableReceipt
): Promise<{ success: boolean; method: 'native-share' | 'web-share' | 'download' }> {
  const { blob, base64, filename } = await generateReceiptPdf(receipt);

  // 1. نظام Android / iOS عبر Capacitor Filesystem و Share
  if (Capacitor.isNativePlatform()) {
    try {
      const writtenFile = await Filesystem.writeFile({
        path: filename,
        data: base64,
        directory: Directory.Cache,
      });

      await Share.share({
        title: `إيصال فاتورة - ${receipt.storeName}`,
        text: `إيصال مبيعات بقيمة ${receipt.totalAmount} ${receipt.currencySymbol}`,
        url: writtenFile.uri,
        dialogTitle: 'مشاركة إيصال البيع',
      });

      return { success: true, method: 'native-share' };
    } catch (e) {
      console.warn('Native share error or dismissed:', e);
    }
  }

  // 2. مشاركة الويب الحديثة navigator.share
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `إيصال فاتورة - ${receipt.storeName}`,
          text: `إيصال مبيعات بقيمة ${receipt.totalAmount} ${receipt.currencySymbol}`,
          files: [file],
        });
        return { success: true, method: 'web-share' };
      }
    } catch {
      // تجاهل إذا ألغى المستخدم المشاركة
    }
  }

  // 3. تنزيل الملف كاحتياط في المتصفح
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return { success: true, method: 'download' };
}
