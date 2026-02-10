"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

function cn(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

type ProgressProps = React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string;
};

const Progress = React.forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-3 w-full overflow-hidden rounded-full bg-slate-100", className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn("h-full w-full flex-1 rounded-full bg-blue-600 transition-all duration-300 ease-in-out", indicatorClassName)}
      style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
    />
  </ProgressPrimitive.Root>
));
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
