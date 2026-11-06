import React, { createContext, useContext, useState } from 'react';
import { formatCurrencyDisplay, formatNumberDisplay } from '../lib/numbers';

export type NumberFormat = 'latin' | 'arabic';

interface SettingsContextType {
  numberFormat: NumberFormat;
  setNumberFormat: (format: NumberFormat) => void;
  formatNumber: (value: number | string | null | undefined, options?: { decimals?: number; minDecimals?: number }) => string;
  formatCurrency: (amount: number | string | null | undefined, currencySymbol?: string, decimals?: number) => string;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const STORAGE_KEY = 'grocery_pos_number_format';

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [numberFormat, setNumberFormatState] = useState<NumberFormat>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === 'arabic' ? 'arabic' : 'latin';
  });

  const setNumberFormat = (format: NumberFormat) => {
    setNumberFormatState(format);
    localStorage.setItem(STORAGE_KEY, format);
  };

  const formatNumber = (value: number | string | null | undefined, options?: { decimals?: number; minDecimals?: number }) => {
    return formatNumberDisplay(value, numberFormat, options);
  };

  const formatCurrency = (amount: number | string | null | undefined, currencySymbol = 'ر.س', decimals = 2) => {
    return formatCurrencyDisplay(amount, currencySymbol, numberFormat, decimals);
  };

  return (
    <SettingsContext.Provider value={{ numberFormat, setNumberFormat, formatNumber, formatCurrency }}>
      {children}
    </SettingsContext.Provider>
  );
};

export function useSettings(): SettingsContextType {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
