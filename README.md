# Rockfall AI — Command Center (Supabase + Vercel)

A zero-build static site: login, role-based dashboard, live browser camera
capture, and a Supabase-backed detection log. No npm install, no bundler.

## What's real vs. simulated
- **Real**: Supabase Auth (email/password), profile roles, image upload to
  Supabase Storage, detection history stored in Postgres, live browser camera
  access via `getUserMedia`.
- **Simulated**: the "high/low risk" classification. There's no trained model
  wired in yet — `js/camera.js` uses a placeholder heuristic
  (`simulateRiskAssessment`) purely so the end-to-end flow is demoable. Swap
  that function for a call to your real inference endpoint when it exists.

## 1. Supabase setup
1. Create a project at supabase.com.
2. Go to **SQL Editor** → paste and run `supabase/schema.sql`. This creates:
   - `profiles` table (role: worker/admin) + auto-create trigger on signup
   - `detections` table (image path, risk level, source, device, timestamp)
   - a private `captures` storage bucket
   - Row Level Security policies for all of the above
3. Go to **Project Settings → API** and copy:
   - **Project URL**
   - **anon / public key**
4. (Optional but recommended) In **Authentication → URL Configuration**, set
   your Vercel production URL as a Redirect URL, and disable "Confirm email"
   if you want instant sign-in during testing.

## 2. Fill in the config
Edit `js/config.js`:
```js
window.ROCKFALL_CONFIG = {
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-public-key",
};
```
The anon key is safe to ship to the browser — access is enforced by the RLS
policies in `schema.sql`, not by hiding this key.

## 3. Deploy to Vercel
This is a static site (no build step), so:
1. Push this folder to a GitHub repo.
2. In Vercel: **New Project** → import the repo.
3. Framework preset: **Other** (or "Static"). Build command: none. Output
   directory: `.` (project root).
4. Deploy. Vercel serves everything over HTTPS automatically.

## Requirements checklist
| Requirement | Why | Where it's handled |
|---|---|---|
| HTTPS | `getUserMedia` (camera access) is blocked by browsers on plain HTTP, except `localhost` | Automatic on Vercel |
| Supabase project URL + anon key | Auth, database, storage all go through this | `js/config.js` |
| `schema.sql` run once | Creates tables, RLS policies, storage bucket | Supabase SQL Editor |
| Browser camera permission | User must click "Allow" when prompted | Handled in `js/camera.js`, with a clear error message if denied |
| A device with a camera | Obviously — works on both laptop webcams and phone cameras (rear camera by default) | — |

## Local testing
Camera access also works on `http://localhost`, so you can just run:
```
python -m http.server 8080
```
and open `http://localhost:8080`. It will NOT work if you open `index.html`
directly via `file://` — serve it, even locally.

## Extending this
- Wire `simulateRiskAssessment()` in `js/camera.js` to your real model's
  inference endpoint (send the captured blob, get back a risk label +
  Grad-CAM heatmap).
- Add an admin-only view (query `profiles.role = 'admin'`) to see every
  worker's detections and to manage roles.
- Add drone telemetry ingestion as its own upload path once a live feed
  source exists.
