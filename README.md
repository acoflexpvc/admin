# Acoflex CMS — Administration Panel

The dedicated content management system and administration application for the Acoflex corporate website.

## Features
- **Admin Authentication:** Secure email/password login guarded by Supabase Auth and `is_admin` security rules.
- **Page Content Management:** Visual editors for all corporate pages (Home, About, Manufacturing, Quality, Infrastructure, Dealers, FAQ, Contact, Resources) with draft staging and explicit publish confirmations.
- **Product & Category Catalogue:** Full product specification editing, variants, applications, features, and category assignment.
- **Media Library:** Upload, preview, alt-text tagging, and CDN link management backed by Supabase Storage (`website-media` bucket).
- **Global Settings:** Draft and publish site-wide contact info, phone numbers, email, WhatsApp, and social channels.

## Tech Stack
- **Framework:** React 19 + Vite
- **Routing:** TanStack Router (SPA)
- **Styling:** Tailwind CSS
- **Data & State:** TanStack React Query + Supabase Client
- **Icons & UI:** Lucide React + Radix UI

## Getting Started

### 1. Prerequisites
- Node.js 18+ (Node 20+ recommended)
- npm or bun

### 2. Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Set your Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_PUBLIC_WEBSITE_URL=https://acoflex.com
```

### 3. Install & Run
```bash
npm install
npm run dev
```

### 4. Build for Production
```bash
npm run build
npm run preview
```

### 5. Deployment
Configured for deployment on Vercel with single-page application routing (`vercel.json`).
