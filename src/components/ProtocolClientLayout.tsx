import { ReactNode } from 'react';

interface ProtocolClientLayoutProps {
  title: string;
  onBack: () => void;
  children: ReactNode;
}

export default function ProtocolClientLayout({ title, onBack, children }: ProtocolClientLayoutProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-white hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-3 py-2 min-h-[44px] min-w-[44px] flex items-center"
          aria-label="Go back to protocol selector"
        >
          ← Back
        </button>
        <h1 className="text-3xl font-bold text-white">{title}</h1>
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
    blue: 'bg-blue-600',
    green: 'bg-green-600',
    purple: 'bg-purple-600',
  };

  return (
    <div className="flex items-center gap-3 mb-4">
      <div className={`flex-shrink-0 w-8 h-8 ${colorClasses[color]} rounded-full flex items-center justify-center`}>
        <span className="text-white font-bold text-sm">{stepNumber}</span>
      </div>
      <h2 className="text-xl font-semibold text-white">{title}</h2>
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
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-300 mb-1">
        {label}{' '}
        {required && <span className="text-red-400" aria-label="required">*</span>}
        {optional && <span className="text-xs text-slate-400">(optional)</span>}
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
        className={`w-full bg-slate-700 border rounded-lg px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-colors ${
          error
            ? 'border-red-500 focus:ring-red-500'
            : 'border-slate-600 focus:ring-blue-500'
        }`}
      />
      {helpText && (
        <p id={`${id}-help`} className="text-xs text-slate-400 mt-1">
          {helpText}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-400 mt-1" role="alert">
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
    primary: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
    secondary: 'bg-slate-600 hover:bg-slate-700 focus:ring-slate-500',
    success: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full ${variantClasses[variant]} text-white font-medium py-3 px-4 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800`}
      aria-label={ariaLabel}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <span
            className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"
            aria-hidden="true"
          ></span>
          {typeof children === 'string' ? `${children}...` : children}
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
      className="mt-6 bg-slate-900 rounded-lg p-4 border border-slate-600"
      role="region"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 mb-2">
        {error ? (
          <span className="text-red-400 text-xl" aria-hidden="true">
            ✕
          </span>
        ) : (
          <span className="text-green-400 text-xl" aria-hidden="true">
            ✓
          </span>
        )}
        <h3 className="text-sm font-semibold text-slate-300">
          {error ? 'Error' : 'Success'}
        </h3>
      </div>
      <pre
        className={`text-sm whitespace-pre-wrap font-mono ${
          error ? 'text-red-400' : 'text-green-400'
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
    <div className="mt-6 pt-6 border-t border-slate-600">
      <h3 className="text-sm font-semibold text-slate-300 mb-2">{title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed mb-3">{description}</p>
      {showKeyboardShortcut && (
        <p className="text-xs text-slate-500 italic">
          <kbd className="px-2 py-1 bg-slate-700 rounded text-slate-300">Enter</kbd> to submit
          forms
        </p>
      )}
    </div>
  );
}
