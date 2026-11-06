import type { PrintableReceipt } from '../types';

/**
 * واجهة برمجية مجردة لمشغلات الطابعات الحرارية (بلوتوث، USB، شبكة)
 * تتيح إضافة اتصال بلوتوث فعلي لاحقاً دون تعديل منطق الإيصال أو الواجهة.
 */
export interface ThermalPrinterDriver {
  id: string;
  name: string;
  type: 'bluetooth' | 'usb' | 'network';
  connect(addressOrId: string): Promise<void>;
  disconnect(): Promise<void>;
  print(commands: Uint8Array): Promise<void>;
  isConnected(): boolean;
}

/**
 * محاكي تجريبي لطابعة البلوتوث الحرارية للتطوير والاختبار
 */
export class MockBluetoothPrinterDriver implements ThermalPrinterDriver {
  id = 'mock-bt-printer';
  name = 'طابعة حرارية بلوتوث (وضع الاستعداد)';
  type = 'bluetooth' as const;
  private connected = false;

  async connect(_addressOrId: string): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  async print(commands: Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new Error('الطابعة غير متصلة.');
    }
    // في وضع الاستعداد: يتم تسجيل أوامر ESC/POS بنجاح
    console.info(`[ThermalPrinter] تم إرسال ${commands.length} بايت من أوامر ESC/POS للطابعة الحرارية.`);
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const activePrinterDriver: ThermalPrinterDriver = new MockBluetoothPrinterDriver();

/**
 * توليد أوامر ESC/POS القياسية للطابعات الحرارية (80mm / 58mm)
 */
export function generateEscPosCommands(receipt: PrintableReceipt): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  const addBytes = (...bytes: number[]) => {
    chunks.push(new Uint8Array(bytes));
  };

  const addText = (text: string) => {
    chunks.push(encoder.encode(text + '\n'));
  };

  // 1. تهيئة الطابعة (ESC @)
  addBytes(0x1b, 0x40);

  // 2. محاذاة في المنتصف لاسم المتجر (ESC a 1)
  addBytes(0x1b, 0x61, 0x01);
  // خط عريض ومكبر (GS ! 0x11)
  addBytes(0x1d, 0x21, 0x11);
  addText(receipt.storeName);
  addBytes(0x1d, 0x21, 0x00); // العودة للحجم العادي

  addText(`إيصال مبيعات: ${receipt.saleId.slice(0, 8)}`);
  addText(`التاريخ: ${new Date(receipt.createdAt).toLocaleString('ar-SA')}`);
  if (receipt.customerName) {
    addText(`العميل: ${receipt.customerName}`);
  }
  addText(`طريقة الدفع: ${receipt.paymentMethod === 'cash' ? 'نقداً' : 'آجل'}`);
  addText('--------------------------------');

  // 3. جدول البنود
  for (const item of receipt.items) {
    addBytes(0x1b, 0x61, 0x02); // محاذاة لليمين
    addText(`${item.name}`);
    addText(`  ${item.quantity} × ${item.unitPrice} = ${item.lineTotal} ${receipt.currencySymbol}`);
  }

  addBytes(0x1b, 0x61, 0x01); // توسيط
  addText('--------------------------------');
  addText(`المجموع الفرعي: ${receipt.subtotal} ${receipt.currencySymbol}`);
  if (Number(receipt.discountAmount) > 0) {
    addText(`الخصم: -${receipt.discountAmount} ${receipt.currencySymbol}`);
  }
  // إجمالي مكبر
  addBytes(0x1d, 0x21, 0x11);
  addText(`الإجمالي: ${receipt.totalAmount} ${receipt.currencySymbol}`);
  addBytes(0x1d, 0x21, 0x00);

  addText('--------------------------------');
  addText('شكراً لزيارتكم!');

  // تغذية الورق 4 أسطر ثم القص الجزئي (GS V 66 0)
  addBytes(0x1b, 0x64, 0x04);
  addBytes(0x1d, 0x56, 0x42, 0x00);

  // دمج كل البايتات في مصفوفة واحدة
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
