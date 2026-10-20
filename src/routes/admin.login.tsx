import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAdminAuth } from "@/lib/admin-auth";
import { images } from "@/lib/site-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Mail, AlertCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/login")({
  head: () => ({
    meta: [
      { title: "Admin Login — Acoflex CMS" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLogin,
});

function AdminLogin() {
  const { user, isAdmin, isLoading: authLoading, signIn, error: authError } = useAdminAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If already authenticated and verified as admin, redirect to admin home
  useEffect(() => {
    if (!authLoading && user && isAdmin) {
      navigate({ to: "/admin" });
    }
  }, [user, isAdmin, authLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);

    if (!result.success) {
      setErrorMessage(result.error || "Login failed. Please check your credentials.");
    } else {
      navigate({ to: "/admin" });
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-forest px-4 py-12 text-white sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-white/10 bg-forest-deep/80 p-8 shadow-2xl backdrop-blur-sm">
        <div className="text-center">
          <div className="inline-flex justify-center">
            <img
              src={images.logo}
              alt="Acoflex"
              className="h-16 w-auto object-contain brightness-0 invert"
            />
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-white">
            CMS Portal
          </h2>
          <p className="mt-1 text-sm text-white/70">
            Sign in with authorized administrator credentials
          </p>
        </div>

        {(errorMessage || authError) && (
          <div
            className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-950/40 p-3.5 text-sm text-red-200"
            role="alert"
          >
            <AlertCircle className="size-5 shrink-0 text-red-400 mt-0.5" />
            <div>
              <p className="font-semibold text-red-100">Authentication Failed</p>
              <p className="mt-0.5 text-red-200/90">{errorMessage || authError}</p>
            </div>
          </div>
        )}

        <form className="mt-6 space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <Label
              htmlFor="admin-email"
              className="text-xs font-semibold uppercase tracking-wider text-white/80"
            >
              Email Address
            </Label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-3 size-4 text-white/40" />
              <Input
                id="admin-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@acoflex.in"
                className="h-11 border-white/15 bg-white/5 pl-10 text-white placeholder:text-white/30 focus-visible:border-gold focus-visible:ring-gold"
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="admin-password"
              className="text-xs font-semibold uppercase tracking-wider text-white/80"
            >
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3.5 top-3 size-4 text-white/40" />
              <Input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="h-11 border-white/15 bg-white/5 pl-10 text-white placeholder:text-white/30 focus-visible:border-gold focus-visible:ring-gold"
                disabled={submitting}
              />
            </div>
          </div>

          <Button
            type="submit"
            variant="gold"
            className="w-full h-11 text-base font-semibold"
            disabled={submitting || authLoading}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Verifying Credentials...
              </>
            ) : (
              "Sign In to Admin Portal"
            )}
          </Button>
        </form>

        <div className="pt-4 border-t border-white/10 text-center">
          <a
            href={import.meta.env.VITE_PUBLIC_WEBSITE_URL || "https://acoflex.com"}
            className="text-xs text-white/60 hover:text-gold transition-colors inline-flex items-center gap-1"
          >
            ← Return to Acoflex Website
          </a>
        </div>
      </div>
    </div>
  );
}
