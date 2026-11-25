# UniBite

**Your Campus. Your Cravings. One Click.**

UniBite is a campus food-ordering platform with three roles:

| Role | Where | What they do |
|---|---|---|
| **Student** | Main website (`/login.html`, *Login as Student*) | Browse restaurants, search dishes, order, track orders, rate |
| **Restaurant Owner** | Main website (*Login as Restaurant*) → `/restaurant-dashboard.html` | Manage their own restaurant's info, menu and orders, and see ratings |
| **Super Admin** | Separate dashboard at `/admin` (sign in at `/admin/login`) | Manage restaurants, applications, owner invitations, accounts and the audit log |

All three share one backend and one database. Everything is dynamic: nothing about restaurants is hardcoded in the frontend.

---

## Easiest way to start

Open the `unibite` folder and double-click **`start-unibite.bat`** on Windows, or **`start-unibite.command`** on Mac.
It installs packages and creates the demo database the first time. It then starts the server from that exact folder and opens the student login page. Keep the window open while you use the site, and close it to stop the server.

## Quick start (local development)

Requires **Node.js 22.5 or newer**. It includes the built-in `node:sqlite` module, so there is no database server to install.

```bash
npm install
npm run seed      # creates data/unibite.db with DEMO data (development only)
npm start         # http://localhost:3000
npm test          # 16 API tests (the 14 required scenarios + security checks)
```

To wipe the database and reload the demo data, run `npm run seed:reset`.

**Demo accounts** (created by `npm run seed`, which refuses to run in production):

| Role | Login page | Email | Password |
|---|---|---|---|
| Super Admin | `/admin/login` | admin@unibite.edu | SuperAdmin2026 |
| Restaurant Owner (Bean There Café) | `/login.html` → Login as Restaurant | owner@unibite.edu | Owner12345 |
| Restaurant Owner (The Grill House) | `/login.html` → Login as Restaurant | grill@unibite.edu | Owner12345 |
| Student | `/login.html` → Login as Student | student@unibite.edu | Student12345 |

**Emails in development.** Without SMTP settings, emails are not sent. Instead they are stored, and you can read them at **`/dev/mailbox.html`**: verification links, owner invitations, password resets and application updates. That page doesn't exist in production.

**Registering a student in the demo.** The email must end in `@unibite.edu`, and the University ID must be one of **20230003–20230050** (the demo university roster).

---

## Production setup

1. Copy `.env.example`. Set `NODE_ENV=production`, `JWT_SECRET`, `APP_URL`, the SMTP settings and your university's email domains and ID rules.
2. Run `npm install --omit=dev`.
3. **Provision the Super Admin on the server.** This is never done from the website:
   ```bash
   npm run admin:create
   ```
   It prompts for the name, email and password (minimum 12 characters). Once a Super Admin exists, adding another administrator requires the existing Super Admin's credentials, plus their 2FA code if enabled. Alternatively, set `ADMIN_EMAIL` / `ADMIN_PASSWORD` for the first boot only.
4. Optionally load the official roster for University ID verification:
   ```bash
   npm run roster:import -- roster.csv
   ```
   The CSV columns are `university_id,email,full_name`; email and name are optional.
5. Run `npm start` behind HTTPS, so cookies are marked `Secure`.
6. Sign in at `/admin/login` and enable **two-factor authentication** under **Admin Security**.

---

## How the main flows work

### Student registration
1. The student fills in Full Name, University Email, University ID, Password and Confirm Password.
2. The server validates the email domain and the University ID format. When a roster is loaded, it also checks the ID against the roster (and the roster email, if one is recorded).
3. University IDs and emails must be unique. The database enforces this with a `UNIQUE` constraint as well.
4. The account is created as **pending**, and a single-use verification link (valid 24 hours) is emailed.
5. Clicking the link activates the account and signs the student in. Pending accounts cannot log in; the login page offers to resend the link.

### Restaurant onboarding
- **Method A – application.** The owner submits *Register your restaurant*. The request is saved as **Pending**, and the Super Admin is notified in-app (bell icon) and by email. The admin can then:
  - **Approve & create restaurant:** opens a pre-filled Add Restaurant form. Restaurant names are unique, so duplicates are blocked.
  - **Link to existing restaurant:** for outlets that already exist. You can optionally replace the current owner.
  - **Reject:** the request is marked Rejected and the applicant is emailed. No access is granted.

  Approval emails the applicant an **owner invitation**.
- **Method B – invitation.** On *Manage Restaurants*, open a restaurant, click **Invite Restaurant Owner** and enter the email. The owner receives a unique, single-use link that expires after 72 hours, creates a password, and is linked to that restaurant by the backend. Admins can **resend** (which revokes the old link) or **revoke** invitations.

### Restaurant deactivation (soft delete)
A deactivated restaurant behaves as follows:
- It disappears from public browsing and dish search, and new orders are refused.
- Its owner keeps **read-only** access. They can view and complete orders placed before deactivation, but cannot edit the menu or restaurant info.
- Orders, ratings and history are preserved. Database foreign keys (`ON DELETE RESTRICT`) prevent hard deletes.

**Reactivate** restores the same record. Restaurants can also be saved as a **Draft** and published later.

---

## Security model

UniBite does not use Supabase, so database row-level security (RLS) doesn't apply. The same guarantees are enforced on the server, with database constraints as a second layer:

| Requirement | Implementation |
|---|---|
| Role-based access | Every API route checks the role on the server (`requireRole`, `requireRestaurantMember`). The admin and dashboard **pages** are also guarded on the server. |
| Owners manage only their restaurant | The restaurant ID comes from the `restaurant_users` table, never from the request. Every query is scoped to it, so other restaurants' data returns 404. |
| Users can't change roles | No endpoint accepts a role. Roles are set only by registration (student), invitation acceptance (restaurant) or the server CLI (admin). |
| Pending / deactivated accounts | Only `status = 'active'` accounts get a session. Each request re-reads the user, so deactivation takes effect immediately. |
| Passwords | bcrypt (cost 12), and never returned by any API. |
| Tokens | Verification, reset, invitation and 2FA-challenge tokens are random (256-bit), single-use and expiring. Only their SHA-256 hashes are stored. |
| Sessions | httpOnly SameSite cookie with a signed JWT, re-validated against the database. Lifetimes are 8 h (admin), 24 h (restaurant) and 7 days (student). Password resets and deactivations revoke all sessions. |
| Super Admin | Separate `/admin/login`. Admin credentials are rejected on the public portals. TOTP two-factor authentication is supported. There is no public admin creation endpoint. |
| CSRF / headers | Mutations require a custom header. The server sends a strict CSP (no inline scripts), `X-Frame-Options: DENY` and `nosniff`. |
| Abuse | Login, registration, email and application endpoints are rate-limited, and login is generic so it doesn't reveal which accounts exist. |
| Audit log | Admin actions are recorded with the admin, the action, the target, previous and updated values, a timestamp and the IP. SQLite **triggers block UPDATE and DELETE** on `audit_logs`. |

---

## Database

The database is upgraded automatically by versioned migrations in `src/db/migrations/` on every start. An existing database is upgraded in place, and integrity is checked with `PRAGMA foreign_key_check`.

| Table | Purpose |
|---|---|
| `users` | id, name, email, password_hash, role, **status** (pending/active/deactivated), email_verified_at, 2FA fields, created_at |
| `student_profiles` | user_id, **university_id (UNIQUE)**, verification_status |
| `restaurants` | All profile fields, availability_status, is_active (soft delete), **published_at**, created_at/updated_at, created_by |
| `restaurant_users` | Association of user ↔ restaurant: assigned_role (owner, with employee reserved for later), status. A partial unique index allows one active owner per restaurant |
| `restaurant_requests` | Owner and restaurant information, status, submitted, reviewed_by, reviewed_at |
| `restaurant_invitations` | restaurant_id, email, token_hash, expires_at, status (pending/accepted/revoked/expired) |
| `auth_tokens` | Email verification, password reset and 2FA challenge tokens (hashed) |
| `products`, `orders`, `order_items`, `order_status_history`, `ratings` | Ordering and history. Order items store the product name and price at the time of ordering |
| `audit_logs` | Append-only |
| `notifications`, `email_outbox`, `university_roster`, `categories` | Supporting tables |

---

## Project structure

```
src/
  app.js, server.js, config.js
  db/            index.js (migrations runner), migrations/*.sql, seed.js, bootstrap.js
  middleware/    auth (sessions, roles), csrf, rateLimit, upload, errors
  services/      mailer, tokens, totp, university, invitations, notifications, restaurants, orders
  routes/        auth, public, student, restaurant, dev (dev mailbox), admin/*
scripts/         create-admin.js, import-roster.js
public/          main website pages, restaurant dashboard, admin/ (dashboard + login), dev/mailbox
tests/           api.test.js
design-system/   UniBite design system (UI/UX Pro Max)
```

## Tests

`npm test` runs against a throwaway database and covers the 14 required scenarios:

1. Student registration and login
2. University ID validation and duplicate prevention
3. Restaurant registration request
4. Admin approval and rejection
5. Admin adds a restaurant and sends an invitation
6. Owner accepts the invitation
7. Owner manages their menu
8. Owner receives and updates orders
9. Deactivation
10. Orders remain accessible after deactivation
11. Reactivation
12. Unauthorized admin access is blocked
13. Owners are blocked from other restaurants' data
14. History is preserved

It also covers account management and 2FA.
