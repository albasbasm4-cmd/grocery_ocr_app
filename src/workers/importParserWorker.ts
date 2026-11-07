import * as XLSX from 'xlsx';

export interface ParseWorkerInput {
  type: 'PARSE_FILE';
  fileBuffer: ArrayBuffer;
  fileName: string;
  fileType: 'xlsx' | 'csv';
}

export interface ParseWorkerSuccess {
  success: true;
  headers: string[];
  rows: string[][];
  totalRows: number;
}

export interface ParseWorkerError {
  success: false;
  error: string;
}

export type ParseWorkerOutput = ParseWorkerSuccess | ParseWorkerError;

self.onmessage = (e: MessageEvent<ParseWorkerInput>) => {
  const { type, fileBuffer, fileType } = e.data;
  if (type !== 'PARSE_FILE') return;

  try {
    let workbook: XLSX.WorkBook;

    if (fileType === 'csv') {
      const decoder = new TextDecoder('utf-8');
      let text = decoder.decode(fileBuffer);
      // إزالة علامة BOM إن وُجدت
      if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
      }
      workbook = XLSX.read(text, { type: 'string', raw: true });
    } else {
      workbook = XLSX.read(new Uint8Array(fileBuffer), { type: 'array', cellDates: true });
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new Error('الملف فارغ ولا يحتوي على أي ورقة عمل.');
    }

    const sheet = workbook.Sheets[firstSheetName];
    if (!sheet) {
      throw new Error('تعذر قراءة الورقة الأولى من الملف.');
    }

    const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: false,
    });

    if (!rawRows || rawRows.length === 0) {
      throw new Error('الملف لا يحتوي على أي صفوف أو بيانات.');
    }

    // الصف الأول ترويسات الأعمدة
    const headers = (rawRows[0] || []).map((h) => String(h || '').trim());
    const dataRows = rawRows
      .slice(1)
      .map((row) => (row || []).map((cell) => String(cell ?? '').trim()))
      .filter((row) => row.some((cell) => cell !== ''));

    const res: ParseWorkerSuccess = {
      success: true,
      headers,
      rows: dataRows,
      totalRows: dataRows.length,
    };
    self.postMessage(res);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'تعذر تحليل الملف المرفوع.';
    const res: ParseWorkerError = {
      success: false,
      error: errorMsg,
    };
    self.postMessage(res);
  }
};
