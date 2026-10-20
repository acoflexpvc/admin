import { createFileRoute, Outlet, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAdminAuth } from "@/lib/admin-auth";
import { images } from "@/lib/site-data";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Boxes,
  Image as ImageIcon,
  Settings,
  LogOut,
  ShieldAlert,
  Loader2,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Website Admin — Acoflex" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminLayout,
});

function AdminLayout() {
  const { user, isAdmin, isLoading, signOut } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isLoginPage = location.pathname === "/admin/login";

  useEffect(() => {
    if (!isLoading && !isLoginPage) {
      if (!user || !isAdmin) {
        navigate({ to: "/admin/login" });
      }
    }
  }, [user, isAdmin, isLoading, isLoginPage, navigate]);

  if (isLoginPage) {
    return <Outlet />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Loader2 className="size-8 animate-spin text-primary mx-auto" />
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

  const navLinks = [
    { label: "Website Pages", to: "/admin", icon: FileText, exact: true },
    { label: "Products & Systems", to: "/admin/products", icon: Boxes },
    { label: "Images & Gallery", to: "/admin/media", icon: ImageIcon },
    { label: "Website Settings", to: "/admin/settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-slate-50/60 dark:bg-background">
      {/* Friendly Admin Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col shrink-0">
        <div className="h-16 border-b border-border flex items-center px-6 gap-3">
          <img src={images.logo} alt="Acoflex" className="h-8 w-auto object-contain" />
          <div className="leading-tight">
            <span className="font-display font-bold text-sm tracking-tight block">Acoflex</span>
            <span className="text-[11px] font-semibold text-muted-foreground block">
              Website Editor
            </span>
          </div>
        </div>

        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-muted/60 p-3 text-xs">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
              Signed In As
            </span>
            <span className="font-medium text-foreground truncate block">{user.email}</span>
          </div>

          <nav className="space-y-1.5">
            {navLinks.map((item) => {
              const Icon = item.icon;
              const isActive = item.exact
                ? location.pathname === item.to || location.pathname.startsWith("/admin/pages")
                : location.pathname.startsWith(item.to);

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-4 border-t border-border space-y-2">
          <a
            href={import.meta.env.VITE_PUBLIC_WEBSITE_URL || "https://acoflex.com"}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              <ExternalLink className="size-3.5 text-primary" />
              View Live Website
            </span>
          </a>
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/admin/login" });
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors"
          >
            <LogOut className="size-3.5 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Working Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <main className="p-8 max-w-5xl w-full mx-auto flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
