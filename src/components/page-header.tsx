import type { ReactNode } from "react";

export const PageHeader = ({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  title: string;
}) => (
  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
    {action && <div className="max-w-full">{action}</div>}
  </div>
);
