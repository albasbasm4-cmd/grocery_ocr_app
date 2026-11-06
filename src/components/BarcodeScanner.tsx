import { BarcodeFormat, BarcodeScanner as MlKitBarcodeScanner } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';
import { Flashlight, Keyboard, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ar } from '../i18n/ar';
import { toLatinDigits } from '../lib/numbers';
import { lookupProductsByCode } from '../services/barcodeLookupService';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import type { Product } from '../types';
import { playScanSound, signalScanSuccess } from '../lib/scanFeedback';

export interface BarcodeScannerProps {
  isOpen: boolean;
  storeId: string;
  onClose: () => void;
  onCode: (code: string) => void;
  onProduct?: (product: Product) => void;
}

const allowedMlKitFormats = [BarcodeFormat.Ean13, BarcodeFormat.Ean8, BarcodeFormat.UpcA, BarcodeFormat.UpcE, BarcodeFormat.Code128, BarcodeFormat.QrCode];
const recentCodes = new Map<string, number>();

export function BarcodeScanner({ isOpen, storeId, onClose, onCode, onProduct }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const zxingControls = useRef<{ stop: () => void; switchTorch?: (enabled: boolean) => Promise<void> } | null>(null);
  const nativeListener = useRef<{ remove: () => Promise<void> } | null>(null);
  const [error, setError] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [matches, setMatches] = useState<Product[]>([]);
  const [torch, setTorch] = useState(false);
  const [searching, setSearching] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [nativeCamera, setNativeCamera] = useState(false);

  const reportCode = useCallback(async (raw: string) => {
    const code = toLatinDigits(raw).trim();
    if (!code) return;
    const now = Date.now();
    const previous = recentCodes.get(code) ?? 0;
    if (now - previous < 1500) return;
    recentCodes.set(code, now);
    void signalScanSuccess().catch(() => undefined);
    playScanSound();
    try {
      const found = await lookupProductsByCode(storeId, code);
      if (found.length === 1) {
        if (onProduct) onProduct(found[0]!);
        else onCode(code);
        onClose();
      } else if (found.length > 1) {
        setManualValue(code);
        setMatches(found);
      } else {
        onCode(code);
        onClose();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : ar.cameraUnavailable);
    }
  }, [onCode, onClose, onProduct, storeId]);

  const searchManual = async () => {
    const value = toLatinDigits(manualValue).trim();
    if (!value) return;
    setSearching(true);
    setError('');
    await reportCode(value);
    setSearching(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setError('');
    setPermissionDenied(false);
    const start = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          const permission = await MlKitBarcodeScanner.checkPermissions();
          if (permission.camera !== 'granted') {
            const requested = await MlKitBarcodeScanner.requestPermissions();
            if (requested.camera !== 'granted') {
              setPermissionDenied(true);
              setError(ar.cameraPermissionDenied);
              return;
            }
          }
          nativeListener.current = await MlKitBarcodeScanner.addListener('barcodesScanned', ({ barcodes }) => {
            const value = barcodes.find((item) => item.rawValue)?.rawValue;
            if (value) reportCode(value);
          });
          await MlKitBarcodeScanner.startScan({ formats: allowedMlKitFormats });
          if (!cancelled) { setCameraRunning(true); setNativeCamera(true); document.body.classList.add('barcode-scanner-active'); }
        } catch {
          if (!cancelled) setError(ar.cameraUnavailable);
        }
      } else if (videoRef.current && navigator.mediaDevices) {
        try {
          const [{ BrowserMultiFormatReader }, { BarcodeFormat: ZxingFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
          const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [ZxingFormat.EAN_13, ZxingFormat.EAN_8, ZxingFormat.UPC_A, ZxingFormat.UPC_E, ZxingFormat.CODE_128, ZxingFormat.QR_CODE]]]);
          const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 180 });
          const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result, _error, activeControls) => {
            zxingControls.current = activeControls;
            if (result) reportCode(result.getText());
          });
          zxingControls.current = controls;
          if (!cancelled) setCameraRunning(true);
        } catch (caught) {
          if (!cancelled) {
            const name = caught instanceof DOMException ? caught.name : '';
            setPermissionDenied(name === 'NotAllowedError' || name === 'PermissionDeniedError');
            setError(name === 'NotAllowedError' ? ar.cameraPermissionDenied : ar.cameraUnavailable);
          }
        }
      } else {
        setError(ar.cameraUnavailable);
      }
    };
    void start();
    return () => {
      cancelled = true;
      zxingControls.current?.stop();
      zxingControls.current = null;
      void nativeListener.current?.remove();
      nativeListener.current = null;
      if (Capacitor.isNativePlatform()) void MlKitBarcodeScanner.stopScan().catch(() => undefined);
      document.body.classList.remove('barcode-scanner-active');
      setCameraRunning(false);
      setNativeCamera(false);
      setTorch(false);
    };
  }, [isOpen, reportCode]);

  const toggleTorch = async () => {
    try {
      const next = !torch;
      if (Capacitor.isNativePlatform()) {
        if (next) await MlKitBarcodeScanner.enableTorch(); else await MlKitBarcodeScanner.disableTorch();
      } else if (zxingControls.current?.switchTorch) {
        await zxingControls.current.switchTorch(next);
      } else {
        setError(ar.cameraUnavailable);
        return;
      }
      setTorch(next);
    } catch {
      setError(ar.cameraUnavailable);
    }
  };

  const openSettings = async () => {
    if (Capacitor.isNativePlatform()) await MlKitBarcodeScanner.openSettings();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.barcodeScanner} maxWidth="lg" transparent={Capacitor.isNativePlatform()}>
      <div className="space-y-4">
        <p className="text-sm text-slate-300">{ar.cameraPermissionReason}</p>
        <div className={`relative aspect-[4/3] overflow-hidden rounded-2xl ${nativeCamera ? 'bg-transparent' : 'bg-black'}`}>
          <video ref={videoRef} className={`h-full w-full object-cover ${nativeCamera ? 'hidden' : ''}`} muted playsInline />
          {cameraRunning && <div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-0.5 -translate-y-1/2 bg-rose-500 shadow-[0_0_12px_3px_rgba(244,63,94,0.6)]"><span className="absolute -inset-x-2 -top-16 h-32 border-x-2 border-emerald-400/80" /></div>}
          {!cameraRunning && <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-slate-300">{error || ar.scanning}</div>}
          <button type="button" aria-label={torch ? ar.torchOff : ar.torchOn} onClick={() => void toggleTorch()} className="absolute left-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white"><Flashlight className={torch ? 'text-amber-300' : ''} /></button>
          <button type="button" aria-label={ar.closeScanner} onClick={onClose} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full bg-black/60 text-white"><X /></button>
        </div>
        {permissionDenied && <Button onClick={() => void openSettings()} variant="outline" className="w-full">{ar.cameraPermissionOpenSettings}</Button>}
        {error && !permissionDenied && <p role="alert" className="rounded-xl bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
        <div className="border-t border-slate-700 pt-4">
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-200"><Keyboard className="h-4 w-4" />{ar.manualBarcodeSku}</label>
          <div className="flex gap-2">
            <input value={manualValue} onChange={(event) => { setManualValue(toLatinDigits(event.target.value)); setMatches([]); }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchManual(); } }} className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-800 px-3 py-3 text-white" dir="auto" />
            <Button onClick={() => void searchManual()} disabled={searching || !manualValue.trim()}>{searching ? ar.loading : ar.searchCode}</Button>
          </div>
        </div>
        {matches.length > 0 && <div className="space-y-2" role="listbox" aria-label={ar.chooseProduct}><p className="text-sm font-bold text-slate-200">{ar.chooseProduct}</p>{matches.map((product) => <button key={product.id} type="button" role="option" aria-selected="false" onClick={() => { if (onProduct) onProduct(product); else reportCode(product.barcode || product.sku_small_text || manualValue); onClose(); }} className="flex w-full items-center justify-between rounded-xl border border-slate-700 bg-slate-800 p-3 text-right"><span className="font-bold text-white">{product.name}</span><span className="text-xs text-slate-400">{product.barcode || product.sku_small_text}</span></button>)}</div>}
      </div>
    </Modal>
  );
}
