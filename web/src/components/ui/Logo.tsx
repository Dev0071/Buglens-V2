/**
 * Buglens Logo Component
 *
 * Reusable logo component with multiple size variants.
 * Uses the official buglens-logo.png from public folder.
 */

import { cn } from "@/lib/utils";

interface LogoProps {
  /** Size variant for the logo */
  size?: "sm" | "md" | "lg" | "xl";
  /** Whether to show the text alongside the logo */
  showText?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Text color class (for dark/light themes) */
  textClassName?: string;
}

const sizeClasses = {
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-10 h-10",
  xl: "w-12 h-12",
};

const textSizeClasses = {
  sm: "text-lg",
  md: "text-xl",
  lg: "text-2xl",
  xl: "text-3xl",
};

/**
 * Buglens logo component with optional text
 */
export default function Logo({
  size = "md",
  showText = true,
  className,
  textClassName = "text-gray-900 dark:text-white",
}: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <img
        src="/buglens-logo.png"
        alt="Buglens"
        className={cn(sizeClasses[size], "rounded-lg object-contain")}
      />
      {showText && (
        <span className={cn("font-bold", textSizeClasses[size], textClassName)}>
          Buglens
        </span>
      )}
    </div>
  );
}

/**
 * Logo icon only (no text)
 */
export function LogoIcon({
  size = "md",
  className,
}: Pick<LogoProps, "size" | "className">) {
  return (
    <img
      src="/buglens-logo.png"
      alt="Buglens"
      className={cn(sizeClasses[size], "rounded-lg object-contain", className)}
    />
  );
}

/**
 * Fallback logo using icon (for cases where image fails to load)
 */
export function LogoFallback({
  size = "md",
  className,
}: Pick<LogoProps, "size" | "className">) {
  return (
    <div
      className={cn(
        sizeClasses[size],
        "bg-brand-500 rounded-lg flex items-center justify-center",
        className
      )}
    >
      <span className="text-white font-bold text-lg">B</span>
    </div>
  );
}
