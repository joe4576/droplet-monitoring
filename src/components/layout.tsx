import type { ReactNode } from "react";
import { Droplet, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Layout = ({ children }: { children: ReactNode }) => (
  <div className="min-h-dvh">
    <a
      className="sr-only fixed top-4 left-4 z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only"
      href="#main"
    >
      Skip to content
    </a>
    <header className="border-b">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <a
          className="flex items-center gap-2.5 rounded-sm font-semibold"
          href="/"
        >
          <Droplet aria-hidden="true" className="size-5" />
          Droplet monitoring
        </a>
        <form action="/api/auth/logout" method="post">
          <Button size="sm" type="submit" variant="ghost">
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" id="main">
      {children}
    </main>
  </div>
);
