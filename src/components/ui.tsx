import React from 'react';
import type { ComponentProps, ReactNode } from 'react';

/**
 * Surface: Single border level container.
 * `inset` is strictly reserved for genuinely recessed interactive stages
 * (oscilloscope canvas well, raw CAN hex terminal).
 */
export const Surface = ({
  inset = false,
  className = '',
  ...props
}: ComponentProps<'div'> & { inset?: boolean }) => (
  <div
    className={`min-w-0 [:where(&)]:rounded-card [:where(&)]:border [:where(&)]:border-border/45 [:where(&)]:text-foreground ${
      inset
        ? '[:where(&)]:bg-surface-recessed'
        : '[:where(&)]:bg-surface [:where(&)]:shadow-surface'
    } ${className}`}
    {...props}
  />
);

const buttonTones = {
  primary:
    '[:where(&)]:bg-primary [:where(&)]:text-primary-foreground [:where(&)]:border [:where(&)]:border-transparent hover:brightness-95',
  quiet:
    '[:where(&)]:border [:where(&)]:border-border/55 [:where(&)]:bg-surface [:where(&)]:text-foreground hover:bg-background',
  danger:
    '[:where(&)]:bg-fault [:where(&)]:text-primary-foreground [:where(&)]:border [:where(&)]:border-transparent hover:brightness-95',
};

export const Button = ({
  tone = 'primary',
  size = 'md',
  type = 'button',
  className = '',
  ...props
}: ComponentProps<'button'> & {
  tone?: keyof typeof buttonTones;
  size?: 'sm' | 'md';
}) => {
  const sizeCls =
    size === 'sm'
      ? '[:where(&)]:min-h-9 [:where(&)]:px-3 [:where(&)]:text-sm'
      : '[:where(&)]:min-h-11 [:where(&)]:px-4 [:where(&)]:text-sm';
  return (
    <button
      type={type}
      className={`[:where(&)]:inline-flex ${sizeCls} [:where(&)]:items-center [:where(&)]:justify-center [:where(&)]:gap-2 whitespace-nowrap [:where(&)]:rounded-control [:where(&)]:font-medium transition-[transform,opacity,background-color,border-color] duration-150 ease-out active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50 ${buttonTones[tone]} ${className}`}
      {...props}
    />
  );
};

export const Field = ({
  label,
  hint,
  id,
  className = '',
  ...props
}: ComponentProps<'input'> & { label: string; hint?: string }) => (
  <div className={`min-w-0 flex flex-col gap-1.5 ${className}`}>
    <label htmlFor={id} className="text-sm font-medium text-foreground">
      {label}
    </label>
    <input
      id={id}
      className="min-h-11 w-full min-w-0 rounded-control border border-border/55 bg-surface px-3 text-sm text-foreground placeholder:text-muted focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50"
      {...props}
    />
    {hint ? <span className="text-xs text-muted">{hint}</span> : null}
  </div>
);

export const SelectField = ({
  label,
  id,
  children,
  className = '',
  ...props
}: ComponentProps<'select'> & { label: string }) => (
  <div className={`min-w-0 flex flex-col gap-1.5 ${className}`}>
    <label htmlFor={id} className="text-sm font-medium text-foreground">
      {label}
    </label>
    <select
      id={id}
      className="min-h-11 w-full min-w-0 rounded-control border border-border/55 bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:opacity-50"
      {...props}
    >
      {children}
    </select>
  </div>
);

/**
 * Quiet status word + glyph (never a static pill badge).
 */
export const StatusMark = ({
  kind,
  label,
}: {
  kind: 'nominal' | 'advisory' | 'fault' | 'neutral';
  label: string;
}) => {
  const glyph =
    kind === 'nominal' ? '●' : kind === 'advisory' ? '▲' : kind === 'fault' ? '✖' : '◌';
  const color =
    kind === 'nominal'
      ? 'text-nominal'
      : kind === 'advisory'
        ? 'text-advisory'
        : kind === 'fault'
          ? 'text-fault'
          : 'text-muted';
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${color}`}>
      <span aria-hidden="true">{glyph}</span>
      <span>{label}</span>
    </span>
  );
};

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected diagnostic interface error.',
    };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-background p-6 flex items-center justify-center">
          <Surface className="max-w-lg w-full p-6 space-y-4" role="alert">
            <h1 className="text-title text-foreground">Workstation session interrupted</h1>
            <p className="text-sm text-muted leading-relaxed">
              The diagnostic console encountered an unexpected interface fault:{' '}
              <span className="font-mono text-foreground">{this.state.message}</span>
            </p>
            <div className="pt-2">
              <Button onClick={() => window.location.reload()}>Reload workstation</Button>
            </div>
          </Surface>
        </div>
      );
    }
    return this.props.children;
  }
}
