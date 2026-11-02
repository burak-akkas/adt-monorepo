import { forwardRef, type ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "xs" | "sm" | "md";

const base =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent font-medium text-white hover:bg-accent-hover",
  secondary: "border border-field font-medium hover:bg-surface-hover",
  ghost: "text-subtle hover:bg-surface-hover hover:text-foreground",
  danger: "text-subtle hover:bg-surface-hover hover:text-danger",
};

const sizes: Record<ButtonSize, string> = {
  xs: "rounded-md px-2 py-1 text-xs",
  sm: "rounded-md px-3 py-1.5 text-sm",
  md: "rounded-lg px-4 py-2 text-sm",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", type = "button", className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={[base, variants[variant], sizes[size], className].filter(Boolean).join(" ")}
      {...props}
    />
  );
});
