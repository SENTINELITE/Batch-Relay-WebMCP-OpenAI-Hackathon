import * as React from "react";

import { cn } from "@/lib/cn";

/** Shared control shell: 48px tall, 14px radius, orange focus halo.
 *  The fill is the page ground, not the card: every one of these sits inside a
 *  Surface, and `bg-card` there gave the control the exact colour of the panel
 *  behind it, so an empty input read as a hairline rectangle rather than
 *  somewhere to type. */
export const fieldControlClassName =
  "h-12 w-full rounded-field border border-border-strong bg-background px-4 text-base text-foreground transition-[border-color,box-shadow] duration-200 ease-[var(--ease-out-expo)] placeholder:text-muted-foreground/70 focus:border-primary focus:shadow-[0_0_0_3px_rgb(255_124_33/.18)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

const selectChevronClassName =
  "appearance-none bg-[image:var(--select-chevron)] bg-[position:right_16px_center] bg-[length:18px_18px] bg-no-repeat pr-11";

type FieldShellProps = {
  children: React.ReactNode;
  containerClassName?: string;
  hint?: React.ReactNode;
  hintId?: string;
  htmlFor: string;
  label: React.ReactNode;
  /** Sits on the label row, right-aligned. Used for a slider's live value, so
   *  the number reads against its own label instead of below the track. */
  trailing?: React.ReactNode;
};

function FieldShell({ children, containerClassName, hint, hintId, htmlFor, label, trailing }: FieldShellProps) {
  return (
    <div className={cn("flex w-full flex-col gap-1.5", containerClassName)}>
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-[15px] font-semibold text-foreground" htmlFor={htmlFor}>
          {label}
        </label>
        {trailing}
      </div>
      {hint ? (
        <p className="text-sm text-muted-foreground" id={hintId}>
          {hint}
        </p>
      ) : null}
      {children}
    </div>
  );
}

type SharedFieldProps = {
  containerClassName?: string;
  hint?: React.ReactNode;
  label: React.ReactNode;
};

export type TextFieldProps = React.InputHTMLAttributes<HTMLInputElement> & SharedFieldProps;

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { className, containerClassName, hint, id, label, ...props },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;

  return (
    <FieldShell
      containerClassName={containerClassName}
      hint={hint}
      hintId={hintId}
      htmlFor={inputId}
      label={label}
    >
      <input
        {...props}
        aria-describedby={props["aria-describedby"] ?? hintId}
        className={cn(fieldControlClassName, className)}
        id={inputId}
        ref={ref}
      />
    </FieldShell>
  );
});

export type SelectFieldProps = React.SelectHTMLAttributes<HTMLSelectElement> & SharedFieldProps;

export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { children, className, containerClassName, hint, id, label, ...props },
  ref,
) {
  const generatedId = React.useId();
  const selectId = id ?? generatedId;
  const hintId = hint ? `${selectId}-hint` : undefined;

  return (
    <FieldShell
      containerClassName={containerClassName}
      hint={hint}
      hintId={hintId}
      htmlFor={selectId}
      label={label}
    >
      <select
        {...props}
        aria-describedby={props["aria-describedby"] ?? hintId}
        className={cn(fieldControlClassName, selectChevronClassName, className)}
        id={selectId}
        ref={ref}
      >
        {children}
      </select>
    </FieldShell>
  );
});

export type RangeFieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> &
  SharedFieldProps & {
    /** What the track's far ends mean, printed under it. A bare 0–100 range
     *  says nothing about which way is left. */
    maxLabel?: React.ReactNode;
    minLabel?: React.ReactNode;
    /** The live reading, shown beside the label rather than under it. Replaces
     *  `hint` as the described-by text so it is still announced. */
    valueLabel?: React.ReactNode;
  };

export const RangeField = React.forwardRef<HTMLInputElement, RangeFieldProps>(function RangeField(
  { className, containerClassName, hint, id, label, maxLabel, minLabel, valueLabel, ...props },
  ref,
) {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const describedBy = hint || valueLabel ? `${inputId}-hint` : undefined;

  return (
    <FieldShell
      containerClassName={containerClassName}
      hint={valueLabel ? undefined : hint}
      hintId={describedBy}
      htmlFor={inputId}
      label={label}
      trailing={
        valueLabel ? (
          <span className="font-mono text-[15px] text-foreground" id={describedBy}>
            {valueLabel}
          </span>
        ) : null
      }
    >
      <input
        {...props}
        aria-describedby={props["aria-describedby"] ?? describedBy}
        className={cn(
          "w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        id={inputId}
        ref={ref}
        type="range"
      />
      {minLabel || maxLabel ? (
        <div className="flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
    </FieldShell>
  );
});
