import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const sizeClasses = {
    sm: 'min-h-[40px] px-3 py-1.5 text-sm rounded-xl',
    md: 'min-h-[48px] px-5 py-2.5 text-base rounded-xl font-bold',
    lg: 'min-h-[56px] px-6 py-3.5 text-lg rounded-2xl font-extrabold',
  }[size];

  const variantClasses = {
    primary:
      'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-slate-950 shadow-md shadow-emerald-500/20 active:scale-[0.98]',
    secondary:
      'bg-slate-800 hover:bg-slate-700 active:bg-slate-800/80 text-slate-100 border border-slate-700 active:scale-[0.98]',
    danger:
      'bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white shadow-md shadow-rose-600/20 active:scale-[0.98]',
    success:
      'bg-teal-600 hover:bg-teal-500 text-white active:scale-[0.98]',
    outline:
      'border border-slate-700 bg-transparent hover:bg-slate-800/60 text-slate-200 active:scale-[0.98]',
    ghost:
      'bg-transparent hover:bg-slate-800 text-slate-300 hover:text-white',
  }[variant];

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 select-none transition-all duration-150 disabled:opacity-50 disabled:pointer-events-none disabled:transform-none ${sizeClasses} ${variantClasses} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
      <span>{children}</span>
    </button>
  );
};
