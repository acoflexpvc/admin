import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Send, Loader2, Clock, MapPin, Building, Share2 } from "lucide-react";
import { StatusBanner, type StatusMessage } from "@/components/admin/status-banner";
import { PublishStateBadge } from "@/components/admin/publish-state-badge";
import { ConfirmDialog } from "@/components/admin/confirm-dialog";
import { getErrorMessage } from "@/lib/errors";

export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [
      { title: "Website Settings — Acoflex" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminSiteSettings,
});

interface SiteSettingsData {
  company?: string;
  address?: string;
  hours?: string;
  phone?: string;
  emails?: string[];
  notice_bar?: {
    location?: string;
    hours?: string;
    email?: string;
    phone?: string;
  };
  social_links?: {
    whatsapp?: string;
    facebook?: string;
    instagram?: string;
    linkedin?: string;
    youtube?: string;
  };
  footer?: {
    tagline?: string;
    origin?: string;
    copyright?: string;
  };
  [key: string]: unknown;
}

function AdminSiteSettings() {
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<SiteSettingsData>({});
  const [initialData, setInitialData] = useState<SiteSettingsData>({});
  const [emailsRaw, setEmailsRaw] = useState("");
  const [initialEmailsRaw, setInitialEmailsRaw] = useState("");
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  // 1. Fetch current settings (Draft preferred, published fallback)
  const {
    data: settingsRecord,
    isLoading,
    error: fetchError,
    refetch,
  } = useQuery({
    queryKey: ["admin_site_settings"],
    queryFn: async () => {
      if (!supabase) throw new Error("Database connection is not available.");

      const { data: rows, error: rowsErr } = await supabase
        .from("site_settings")
        .select("version, data")
        .eq("setting_key", "global");

      if (rowsErr) throw rowsErr;
      const draftData = rows?.find((row) => row.version === "draft");
      const pubData = rows?.find((row) => row.version === "published");
      const current = draftData ?? pubData;
      return {
        data: current?.data,
        // A draft row stays after publishing, so compare it with the live version.
        isDraft:
          !!draftData && JSON.stringify(draftData.data) !== JSON.stringify(pubData?.data ?? null),
      };
    },
  });

  useEffect(() => {
    if (settingsRecord?.data) {
      const data = settingsRecord.data as SiteSettingsData;

      // Sanitize old deprecated emails from database record
      const rawList = Array.isArray(data.emails) ? data.emails : [];
      const sanitizedEmails = rawList
        .map((e) =>
          typeof e === "string" && e.toLowerCase().includes("acoflexpvc.com")
            ? "acoflexpvc@gmail.com"
            : typeof e === "string"
              ? e.trim()
              : "",
        )
        .filter(Boolean);
      const uniqueEmails = Array.from(new Set(sanitizedEmails));
      const finalEmails = uniqueEmails.length > 0 ? uniqueEmails : ["acoflexpvc@gmail.com"];

      const rawNoticeEmail = data.notice_bar?.email;
      const sanitizedNoticeEmail =
        !rawNoticeEmail || rawNoticeEmail.toLowerCase().includes("acoflexpvc.com")
          ? "acoflexpvc@gmail.com"
          : rawNoticeEmail.trim();

      const cleanedData: SiteSettingsData = {
        ...data,
        emails: finalEmails,
        phone: data.phone || "+91 79762 63302",
        notice_bar: {
          ...data.notice_bar,
          email: sanitizedNoticeEmail,
          phone: data.notice_bar?.phone || "+91 79762 63302",
        },
        social_links: {
          whatsapp: data.social_links?.whatsapp || "https://wa.me/917976263302",
          youtube:
            data.social_links?.youtube ||
            "https://www.youtube.com/channel/UCwyCcoI6ttDIM3TsK_W3OGQ",
          facebook:
            data.social_links?.facebook || "https://www.facebook.com/profile.php?id=61595401024633",
          linkedin:
            data.social_links?.linkedin || "https://www.linkedin.com/in/acoflex-pvc-72094a444/",
          instagram: data.social_links?.instagram || "https://www.instagram.com/acoflexpvc/?hl=en",
        },
      };

      setFormData(cleanedData);
      setInitialData(cleanedData);
      const eStr = finalEmails.join(", ");
      setEmailsRaw(eStr);
      setInitialEmailsRaw(eStr);
    }
  }, [settingsRecord]);

  // Compute dirty working state
  const isDirty = useMemo(() => {
    if (!initialData || Object.keys(initialData).length === 0) return false;
    const dataChanged = JSON.stringify(formData) !== JSON.stringify(initialData);
    const emailsChanged = emailsRaw !== initialEmailsRaw;
    return dataChanged || emailsChanged;
  }, [formData, initialData, emailsRaw, initialEmailsRaw]);

  // Warn before unload when dirty
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
        return e.returnValue;
      }
      return undefined;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // 2. Mutation to Save Draft
  const saveDraftMutation = useMutation({
    mutationFn: async (updatedData: SiteSettingsData) => {
      if (!supabase) throw new Error("Database connection is not available.");

      const { data, error } = await supabase
        .from("site_settings")
        .upsert(
          {
            setting_key: "global",
            version: "draft",
            data: updatedData,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "setting_key,version" },
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setInitialData(formData);
      setInitialEmailsRaw(emailsRaw);
      setStatusMessage({
        type: "success",
        text: "Changes saved as draft. When you are ready, click 'Publish Changes' to make them visible to website visitors.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin_site_settings"] });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: `Unable to save changes: ${getErrorMessage(err)}`,
      });
    },
  });

  // 3. Mutation to Publish to Live
  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!supabase) throw new Error("Database connection is not available.");

      const parsedEmails = emailsRaw
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);

      const latestData: SiteSettingsData = {
        ...formData,
        emails: parsedEmails,
      };

      // Stop if the working copy cannot be saved, rather than publishing an older draft.
      const { error: draftErr } = await supabase.from("site_settings").upsert(
        {
          setting_key: "global",
          version: "draft",
          data: latestData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "setting_key,version" },
      );
      if (draftErr) throw draftErr;

      const { error } = await supabase.rpc("publish_site_settings", {
        target_key: "global",
      });

      if (error) throw error;
      return true;
    },
    onSuccess: () => {
      setInitialData(formData);
      setInitialEmailsRaw(emailsRaw);
      setStatusMessage({
        type: "success",
        text: "Website settings published successfully! The live website is now updated.",
      });
      queryClient.invalidateQueries({ queryKey: ["admin_site_settings"] });
      queryClient.invalidateQueries({ queryKey: ["site-settings", "published"] });
    },
    onError: (err: unknown) => {
      setStatusMessage({
        type: "error",
        text: `Unable to publish: ${getErrorMessage(err)}`,
      });
    },
  });

  const handleSaveDraft = (e?: React.FormEvent) => {
    e?.preventDefault();
    setStatusMessage(null);

    const parsedEmails = emailsRaw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    const updated: SiteSettingsData = {
      ...formData,
      emails: parsedEmails,
    };

    saveDraftMutation.mutate(updated);
  };

  const handlePublish = () => setConfirmPublish(true);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-primary" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-6 text-destructive">
        <p className="font-semibold">Unable to load settings</p>
        <p className="text-sm mt-1">{getErrorMessage(fetchError)}</p>
        <Button onClick={() => refetch()} variant="outline" className="mt-4">
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Friendly Actions */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-border">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              General Website Settings
            </h1>
            <PublishStateBadge isDirty={isDirty} hasDraft={settingsRecord?.isDraft ?? false} />
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Update your business phone numbers, emails, office address, and top contact banner.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="default"
            onClick={() => handleSaveDraft()}
            disabled={saveDraftMutation.isPending || publishMutation.isPending}
            className="gap-2 font-medium"
          >
            {saveDraftMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save Draft
          </Button>
          <Button
            type="button"
            variant="gold"
            size="default"
            onClick={handlePublish}
            disabled={publishMutation.isPending || saveDraftMutation.isPending}
            className="gap-2 font-semibold shadow-xs"
          >
            {publishMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            Publish Changes
          </Button>
        </div>
      </div>

      {/* Status Notice */}
      <StatusBanner message={statusMessage} onDismiss={() => setStatusMessage(null)} />

      {/* Clear Forms */}
      <form onSubmit={handleSaveDraft} className="space-y-6">
        {/* Top Contact Strip */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <MapPin className="size-4.5 text-primary" />
              Header Notice Bar (Top Strip)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              The line displayed at the very top of the website on computers and tablets.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="notice-location">City / Location Label</Label>
              <Input
                id="notice-location"
                value={formData.notice_bar?.location || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    notice_bar: { ...formData.notice_bar, location: e.target.value },
                  })
                }
                placeholder="Barara, Ambala, Haryana"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notice-phone">Direct Phone</Label>
              <Input
                id="notice-phone"
                value={formData.notice_bar?.phone || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    notice_bar: { ...formData.notice_bar, phone: e.target.value },
                  })
                }
                placeholder="+91 79762 63302"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notice-hours">Opening Hours Note</Label>
              <Input
                id="notice-hours"
                value={formData.notice_bar?.hours || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    notice_bar: { ...formData.notice_bar, hours: e.target.value },
                  })
                }
                placeholder="Mon–Sat, 8:00–17:30"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notice-email">Contact Email</Label>
              <Input
                id="notice-email"
                type="email"
                value={formData.notice_bar?.email || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    notice_bar: { ...formData.notice_bar, email: e.target.value },
                  })
                }
                placeholder="acoflexpvc@gmail.com"
              />
            </div>
          </div>
        </div>

        {/* Company & Office Info */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Building className="size-4.5 text-primary" />
              Company Details & Contact Information
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Used in the footer and contact sections across the website.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="company-name">Company Legal Name</Label>
              <Input
                id="company-name"
                value={formData.company || ""}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                placeholder="Saiyanm Industries Pvt. Ltd."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="company-phone">Direct Business Phone</Label>
              <Input
                id="company-phone"
                value={formData.phone || ""}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+91 79762 63302"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="general-hours">Standard Working Hours</Label>
              <Input
                id="general-hours"
                value={formData.hours || ""}
                onChange={(e) => setFormData({ ...formData, hours: e.target.value })}
                placeholder="Monday–Saturday, 8:00–17:30"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="emails-list">Contact Email Addresses (separated by commas)</Label>
            <Input
              id="emails-list"
              value={emailsRaw}
              onChange={(e) => setEmailsRaw(e.target.value)}
              placeholder="acoflexpvc@gmail.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="factory-address">Factory & Office Full Address</Label>
            <Textarea
              id="factory-address"
              rows={2}
              value={formData.address || ""}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              placeholder="Vill Simbla (Behind Hanuman Mandir), P.O., Teh. Barara, Distt. Ambala, Haryana 133201, India"
            />
          </div>
        </div>

        {/* Social Media Channels */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Share2 className="size-4.5 text-primary" />
              Social Media Channels & Profiles
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Official links displayed in the website footer, contact drawer, and contact page.
              Leaving a field blank hides that icon.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="social-whatsapp">WhatsApp Chat Link or Number</Label>
              <Input
                id="social-whatsapp"
                type="text"
                inputMode="url"
                value={formData.social_links?.whatsapp || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    social_links: { ...formData.social_links, whatsapp: e.target.value },
                  })
                }
                placeholder="https://wa.me/917976263302"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="social-youtube">YouTube Channel URL</Label>
              <Input
                id="social-youtube"
                type="url"
                value={formData.social_links?.youtube || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    social_links: { ...formData.social_links, youtube: e.target.value },
                  })
                }
                placeholder="https://www.youtube.com/channel/UCwyCcoI6ttDIM3TsK_W3OGQ"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="social-facebook">Facebook Page URL</Label>
              <Input
                id="social-facebook"
                type="url"
                value={formData.social_links?.facebook || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    social_links: { ...formData.social_links, facebook: e.target.value },
                  })
                }
                placeholder="https://www.facebook.com/profile.php?id=61595401024633"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="social-linkedin">LinkedIn Profile URL</Label>
              <Input
                id="social-linkedin"
                type="url"
                value={formData.social_links?.linkedin || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    social_links: { ...formData.social_links, linkedin: e.target.value },
                  })
                }
                placeholder="https://www.linkedin.com/in/acoflex-pvc-72094a444/"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="social-instagram">Instagram Profile URL</Label>
              <Input
                id="social-instagram"
                type="url"
                value={formData.social_links?.instagram || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    social_links: { ...formData.social_links, instagram: e.target.value },
                  })
                }
                placeholder="https://www.instagram.com/acoflexpvc/?hl=en"
              />
            </div>
          </div>
        </div>

        {/* Website Footer Tagline */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Clock className="size-4.5 text-primary" />
              Website Footer Note
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Text shown at the bottom of every page.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="footer-tagline">Footer Tagline</Label>
              <Input
                id="footer-tagline"
                value={formData.footer?.tagline || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    footer: { ...formData.footer, tagline: e.target.value },
                  })
                }
                placeholder="Plumbing, drainage and agriculture pipe systems..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="footer-origin">Origin Badge</Label>
              <Input
                id="footer-origin"
                value={formData.footer?.origin || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    footer: { ...formData.footer, origin: e.target.value },
                  })
                }
                placeholder="Made in India"
              />
            </div>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-border">
          <Button
            type="submit"
            variant="outline"
            disabled={saveDraftMutation.isPending || publishMutation.isPending}
            className="gap-2"
          >
            {saveDraftMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Save Draft
          </Button>
          <Button
            type="button"
            variant="gold"
            onClick={handlePublish}
            disabled={publishMutation.isPending || saveDraftMutation.isPending}
            className="gap-2 font-semibold shadow-xs"
          >
            {publishMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Publish Changes
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title="Publish website settings?"
        description="The new contact details, social links and footer text will appear on every page of the live website straight away."
        confirmLabel="Publish Changes"
        onConfirm={() => {
          setStatusMessage(null);
          publishMutation.mutate();
        }}
      />
    </div>
  );
}
