import { Haptics, NotificationType } from '@capacitor/haptics';

export async function signalScanSuccess(): Promise<void> {
  await Haptics.notification({ type: NotificationType.Success });
}

export function playScanSound(): void {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 1046;
    oscillator.type = 'sine';
    gain.gain.setValueAtTime(0.05, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.1);
    window.setTimeout(() => void context.close(), 150);
  } catch {
    // Audio feedback is optional; haptics and visual feedback remain available.
  }
}
