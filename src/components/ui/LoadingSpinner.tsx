import React from 'react';
import { Loader2 } from 'lucide-react';

export const LoadingSpinner: React.FC<{ message?: string; size?: 'sm' | 'md' | 'lg' }> = ({
  message,
  size = 'md',
}) => {
  const sizeClass = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }[size];

  return (
    <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400">
      <Loader2 className={`${sizeClass} animate-spin text-emerald-400 mb-3`} />
      {message && <p className="text-sm font-medium">{message}</p>}
    </div>
  );
};

export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-6 w-full' }) => {
  return <div className={`animate-pulse rounded-xl bg-slate-800/80 ${className}`} />;
};
