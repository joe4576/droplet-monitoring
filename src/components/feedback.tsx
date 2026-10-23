import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Feedback = ({
  action,
  children,
  error = false,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  error?: boolean;
  title?: string;
}) => (
  <div
    className={cn({
      inputs: [
        "flex flex-col gap-4 rounded-lg border p-4 text-sm sm:flex-row sm:items-center sm:justify-between",
        error && "border-destructive/40",
      ],
    })}
    role={error ? "alert" : "status"}
  >
    <div className="min-w-0 space-y-1">
      {title && <p className="font-medium">{title}</p>}
      {children && <div className="text-muted-foreground">{children}</div>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);
