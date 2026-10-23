import { createFileRoute, Navigate } from "@tanstack/react-router";

/**
 * The separate Hero Slider screen was replaced by the "Homepage Hero Banner"
 * section of the Home page editor (shared text + 1–4 images, saved and
 * published with the page). This route stays so old bookmarks keep working.
 */
export const Route = createFileRoute("/admin/hero")({
  component: () => (
    <Navigate to="/admin/pages/$slug" params={{ slug: "home" }} hash="hero-banner" replace />
  ),
});
