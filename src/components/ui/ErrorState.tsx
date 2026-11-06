import React from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { Button } from './Button';
import { ar } from '../../i18n/ar';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = ar.genericError,
  message,
  onRetry,
}) => {
  return (
    <div className="p-6 rounded-2xl border border-rose-500/30 bg-rose-950/20 text-center my-4">
      <AlertCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
      <h4 className="text-base font-bold text-rose-200">{title}</h4>
      <p className="text-xs text-rose-300/80 mt-1 mb-4">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="secondary" size="sm" icon={<RotateCcw className="w-4 h-4" />}>
          {ar.retry}
        </Button>
      )}
    </div>
  );
};
