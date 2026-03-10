import { ReactNode } from 'react';

interface ProtocolClientLayoutProps {
  title: string;
  onBack: () => void;
  children: ReactNode;
}

export default function ProtocolClientLayout({ title, onBack, children }: ProtocolClientLayoutProps) {
  return (
    <div className="max-w-4xl mx-auto px-4 pb-12">
      <div className="mb-8 flex items-center gap-4">
        <button
          onClick={onBack}
          className="group flex items-center gap-1.5 text-slate-400 hover:text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 rounded-lg px-3 py-2 min-h-[44px] min-w-[44px] hover:bg-white/5"
          aria-label="Go back to protocol selector"
        >
          <svg className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </button>
        <div className="h-6 w-px bg-slate-700" aria-hidden="true" />
        <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  );
}

interface SectionHeaderProps {
  stepNumber: number;
  title: string;
  color?: 'blue' | 'green' | 'purple';
}

export function SectionHeader({ stepNumber, title, color = 'blue' }: SectionHeaderProps) {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600 shadow-blue-500/25',
    green: 'from-emerald-500 to-emerald-600 shadow-emerald-500/25',
    purple: 'from-purple-500 to-purple-600 shadow-purple-500/25',
  };

  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`flex-shrink-0 w-7 h-7 bg-gradient-to-br ${colorClasses[color]} rounded-lg flex items-center justify-center shadow-lg`}>
        <span className="text-white font-semibold text-xs">{stepNumber}</span>
      </div>
      <h2 className="text-lg font-semibold text-slate-100 tracking-tight">{title}</h2>
    </div>
  );
}

interface FormFieldProps {
  id: string;
  label: string;
  type?: 'text' | 'number' | 'password';
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  required?: boolean;
  optional?: boolean;
  helpText?: string;
  min?: string;
  max?: string;
  error?: string;
}

export function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  onKeyDown,
  placeholder,
  required = false,
  optional = false,
  helpText,
  min,
  max,
  error,
}: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-slate-300">
        {label}{' '}
        {required && <span className="text-red-400" aria-label="required">*</span>}
        {optional && <span className="text-xs text-slate-500">(optional)</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        min={min}
        max={max}
        aria-required={required}
        aria-describedby={helpText ? `${id}-help` : undefined}
        aria-invalid={error ? 'true' : 'false'}
        autoComplete={type === 'password' ? 'off' : undefined}
        className={`w-full bg-slate-800/50 border rounded-lg px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:ring-2 transition-all duration-200 ${
          error
            ? 'border-red-500/50 focus:ring-red-500/40 focus:border-red-500/50'
            : 'border-slate-600/50 focus:ring-blue-500/40 focus:border-blue-500/50 hover:border-slate-500/50'
        }`}
      />
      {helpText && (
        <p id={`${id}-help`} className="text-xs text-slate-500 mt-1">
          {helpText}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-1 flex items-center gap-1" role="alert">
          <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </p>
      )}
    </div>
  );
}

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'success';
  children: ReactNode;
  ariaLabel?: string;
}

export function ActionButton({
  onClick,
  disabled = false,
  loading = false,
  variant = 'primary',
  children,
  ariaLabel,
}: ActionButtonProps) {
  const variantClasses = {
    primary: 'bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 focus:ring-blue-500/50',
    secondary: 'bg-slate-700/80 hover:bg-slate-600/80 border border-slate-600/50 shadow-lg shadow-black/10 focus:ring-slate-500/50',
    success: 'bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30 focus:ring-emerald-500/50',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full ${variantClasses[variant]} text-white font-medium py-3 px-4 rounded-xl transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 active:scale-[0.98]`}
      aria-label={ariaLabel}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span
            className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
            aria-hidden="true"
          ></span>
          <span className="opacity-80">{typeof children === 'string' ? `${children}...` : children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

interface ResultDisplayProps {
  result?: string;
  error?: string;
}

export function ResultDisplay({ result, error }: ResultDisplayProps) {
  if (!result && !error) return null;

  return (
    <div
      className={`mt-6 rounded-xl p-4 border backdrop-blur-sm ${
        error
          ? 'bg-red-950/30 border-red-500/20'
          : 'bg-emerald-950/30 border-emerald-500/20'
      }`}
      role="region"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-3">
        {error ? (
          <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        ) : (
          <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
        <h3 className="text-sm font-semibold text-slate-200">
          {error ? 'Error' : 'Success'}
        </h3>
      </div>
      <pre
        className={`text-sm whitespace-pre-wrap font-mono leading-relaxed ${
          error ? 'text-red-300/90' : 'text-emerald-300/90'
        }`}
      >
        {error || result}
      </pre>
    </div>
  );
}

interface HelpSectionProps {
  title: string;
  description: string;
  showKeyboardShortcut?: boolean;
}

export function HelpSection({ title, description, showKeyboardShortcut = true }: HelpSectionProps) {
  return (
    <div className="mt-6 pt-6 border-t border-slate-700/50">
      <h3 className="text-sm font-semibold text-slate-300 mb-2">{title}</h3>
      <p className="text-sm text-slate-400 leading-relaxed mb-3">{description}</p>
      {showKeyboardShortcut && (
        <p className="text-xs text-slate-500">
          Press{' '}
          <kbd className="px-1.5 py-0.5 bg-slate-800/80 border border-slate-700/50 rounded text-slate-300 text-xs font-mono">
            Enter
          </kbd>{' '}
          to submit
        </p>
      )}
    </div>
  );
}
