import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils/cn';

const controlClasses =
  'w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] ' +
  'bg-[var(--surface-raised)] px-2.5 py-1.5 text-[14px] text-[var(--text-primary)] ' +
  'placeholder:text-[var(--text-muted)] transition-colors duration-100 ' +
  'disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-[var(--color-critical)]';

export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(controlClasses, 'h-9', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(controlClasses, 'min-h-20 resize-y', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  ({ className, ...props }, ref) => (
    <select ref={ref} className={cn(controlClasses, 'h-9 pr-8', className)} {...props} />
  ),
);
Select.displayName = 'Select';

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-[13px] font-medium text-[var(--text-secondary)]', className)}
    {...props}
  />
));
Label.displayName = 'Label';

/**
 * Labels sit above inputs and are always visible; placeholders never substitute
 * for them. Required is marked, not optional — most fields are required, so
 * marking the minority is less visual noise.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string[] | undefined;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-1 text-[var(--color-critical)]" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: htmlFor,
            'aria-invalid': error && error.length > 0 ? true : undefined,
            'aria-describedby': error?.length ? errorId : hint ? hintId : undefined,
          })
        : children}
      {hint && !error?.length ? (
        <p id={hintId} className="text-[12px] text-[var(--text-muted)]">
          {hint}
        </p>
      ) : null}
      {error?.length ? (
        <p id={errorId} className="text-[12px] text-[var(--color-critical)]">
          {error.join('. ')}
        </p>
      ) : null}
    </div>
  );
}
