import { createFileRoute, Outlet, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/admin-auth";
import { images } from "@/lib/site-data";
import { publicSiteUrl } from "@/lib/site-url";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  FileText,
  Boxes,
  Image as ImageIcon,
  Settings,
  LogOut,
  ShieldAlert,
  Loader2,
  ExternalLink,
  Menu,
  PanelTop,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Website Admin — Acoflex" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminLayout,
});

type NavItem = {
  label: string;
  to: "/admin" | "/admin/pages/home" | "/admin/products" | "/admin/media" | "/admin/settings";
  icon: typeof FileText;
  hash?: string;
  isActive: (path: string) => boolean;
};

const navLinks: NavItem[] = [
  {
    label: "Website Pages",
    to: "/admin",
    icon: FileText,
    isActive: (path) =>
      path === "/admin" || (path.startsWith("/admin/pages") && path !== "/admin/pages/home"),
  },
  {
    // Shortcut into the Home page editor, where the banner is managed with the rest of the page.
    label: "Homepage Banner",
    to: "/admin/pages/home",
    icon: PanelTop,
    hash: "hero-banner",
    isActive: (path) => path === "/admin/pages/home",
  },
  {
    label: "Products & Systems",
    to: "/admin/products",
    icon: Boxes,
    isActive: (path) => path.startsWith("/admin/products") || path === "/admin/categories",
  },
  {
    label: "Images & Gallery",
    to: "/admin/media",
    icon: ImageIcon,
    isActive: (path) => path.startsWith("/admin/media"),
  },
  {
    label: "Website Settings",
    to: "/admin/settings",
    icon: Settings,
    isActive: (path) => path.startsWith("/admin/settings"),
  },
];

function AdminLayout() {
  const { user, isAdmin, isLoading, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isLoginPage = location.pathname === "/admin/login";

  useEffect(() => {
    if (!isLoading && !isLoginPage) {
      if (!user || !isAdmin) {
        navigate({ to: "/admin/login" });
      }
    }
  }, [user, isAdmin, isLoading, isLoginPage, navigate]);

  // Close the mobile menu after navigating.
  useEffect(() => setMobileNavOpen(false), [location.pathname]);

  if (isLoginPage) {
    return <Outlet />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3" role="status">
          <Loader2 className="size-8 animate-spin text-primary mx-auto" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">Opening website editor...</p>
        </div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center space-y-4">
          <div className="size-12 rounded-full bg-destructive/10 text-destructive mx-auto flex items-center justify-center">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Sign In Required</h1>
          <p className="text-sm text-muted-foreground">
            Please sign in with your administrator account to edit the website.
          </p>
          <Button
            onClick={() => navigate({ to: "/admin/login" })}
            variant="default"
            className="mt-2"
          >
            Go to Sign In
          </Button>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <>
      <div className="p-4 space-y-4">
        <div className="rounded-lg bg-muted/60 p-3 text-xs">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
            Signed In As
          </span>
          <span className="font-medium text-foreground truncate block" title={user.email}>
            {user.email}
          </span>
        </div>

        <nav className="space-y-1.5" aria-label="Admin sections">
          {navLinks.map((item) => {
            const Icon = item.icon;
            const active = item.isActive(location.pathname);
            return (
              <Link
                key={item.label}
                to={item.to}
                {...(item.hash ? { hash: item.hash } : {})}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-10 items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  active
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-border space-y-2">
        <a
          href={publicSiteUrl("/")}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-10 items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ExternalLink className="size-3.5 text-primary" aria-hidden="true" />
          View Live Website
        </a>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            navigate({ to: "/admin/login" });
          }}
          className="w-full flex min-h-10 items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-3.5 shrink-0" aria-hidden="true" />
          Sign Out
        </button>
      </div>
    </>
  );

  const brand = (
    <div className="flex items-center gap-3">
      {/* The logo artwork is white, so it sits on a brand-green tile. */}
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-forest p-1.5">
        <img src={images.logo} alt="Acoflex" className="h-full w-auto object-contain" />
      </span>
      <div className="leading-tight">
        <span className="font-display font-bold text-sm tracking-tight block">Acoflex</span>
        <span className="text-[11px] font-semibold text-muted-foreground block">
          Website Editor
        </span>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50/60 dark:bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card lg:flex">
        <div className="h-16 border-b border-border flex items-center px-6">{brand}</div>
        {sidebarContent}
      </aside>

      {/* Mobile / tablet navigation drawer */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="flex w-72 max-w-[85vw] flex-col gap-0 p-0">
          <div className="h-16 border-b border-border flex items-center px-5">{brand}</div>
          <SheetTitle className="sr-only">Admin menu</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a section of the website editor
          </SheetDescription>
          {sidebarContent}
        </SheetContent>
      </Sheet>

      {/* Main Working Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-3 border-b border-border bg-card/95 px-4 backdrop-blur lg:hidden">
          {brand}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={mobileNavOpen}
          >
            <Menu />
          </Button>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
