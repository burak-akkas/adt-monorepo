import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export type FieldSize = "sm" | "md";

const base =
  "rounded-lg border border-field bg-surface text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 dark:[color-scheme:dark]";

const sizes: Record<FieldSize, string> = {
  sm: "rounded-md px-1.5 py-0.5 text-xs",
  md: "px-3 py-2",
};

function fieldClass(size: FieldSize, className?: string) {
  return [base, sizes[size], className].filter(Boolean).join(" ");
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { fieldSize?: FieldSize }>(
  function Input({ fieldSize = "md", className, ...props }, ref) {
    return <input ref={ref} className={fieldClass(fieldSize, className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { fieldSize?: FieldSize }
>(function Textarea({ fieldSize = "md", className, ...props }, ref) {
  return <textarea ref={ref} className={fieldClass(fieldSize, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { fieldSize?: FieldSize }>(
  function Select({ fieldSize = "md", className, ...props }, ref) {
    return <select ref={ref} className={fieldClass(fieldSize, className)} {...props} />;
  },
);
