# ADR 0007: Cloud early access, pricing and installation service

## Status

Accepted

## Date

2026-11-24

## Context

`docs/editions.md` lists a Cloud offer and a Business edition but left prices
open. The project is maintained by one person and is still in active
development: some screens are missing and some workflows are incomplete
(`docs/functionality.md`). The maintainer wants to earn from hosting and
setup work without promising a fully supported commercial service.

Constraints:

- Working-time records are a legal obligation for customers. Losing them is
  the worst failure a hosted offer can have, so backups are not optional.
- Customers' data must stay in the EU, and HR data includes special-category
  data (`COMPLIANCE.md`).
- Legal-compliance features are never paid (`docs/editions.md`).

## Decision

1. **Offers.** Community (free, self-hosted, AGPL), Cloud (hosted Community),
   Cloud Business (hosted Community plus Business features), Business
   self-hosted (licence key, contact first) and an installation service
   (we install LibreHR on the customer's server or cloud account). The
   partner programme stays as described in `docs/editions.md`.
2. **Price per active employee with a monthly minimum**, not a flat fee. It
   scales with company size and with our costs (storage, email, support),
   and the minimum stops very small accounts from costing more than they pay.
   An active employee is one who has not been terminated. Auditors and
   inspectors (TIM-008) are not employees and are not billed.
3. **Prices (EUR, excluding VAT/IVA):**

   | Offer               | Price                       | Minimum    |
   | ------------------- | --------------------------- | ---------- |
   | Cloud               | 2 per active employee/month | 20 / month |
   | Cloud Business      | 4 per active employee/month | 60 / month |
   | Business, self-host | Agreed per customer         | —          |
   | Installation        | From 300, one-off           | —          |
   | Maintenance         | From 40 / month, optional   | —          |

   Yearly billing gets two months free. With Cloud Business, every active
   employee of the organization is billed at the Business rate, because the
   licence and its features (for example SSO) apply to the whole
   organization.

4. **Cloud is sold as early access.** We promise: EU hosting, daily backups
   kept 7 days, a full copy of the customer's data on request, and a data
   processing agreement (DPA) with every customer. We do not promise: an
   uptime guarantee (SLA), response times (support is email, best effort,
   within a few working days) or a fixed feature set. Liability is capped at
   the fees paid in the previous 12 months. Customers are businesses (B2B).
5. **No free trial.** The Community edition is the trial: anyone can install
   it for free, or pay for the installation service.
6. **Cloud infrastructure.**
   - Database: Supabase, in an EU region. The Free plan has no automatic
     backups, a 0.5 GB limit and pauses inactive projects, so it is used only
     for a demo or a test deployment. The first paying customer requires the
     Pro plan (daily backups, 7-day retention).
   - Web, API, worker and file storage: one EU VPS to start.
   - Transactional email (invitations, password resets, notifications): an
     EU SMTP provider.
   - Before the first customer, a test deployment must confirm that the
     migrations' roles (`librehr_owner`, `librehr_app`), RLS and pg-boss work
     on Supabase, including through its connection pooler.

## Consequences

- The website shows these prices and the early-access terms. Self-service
  signup is out of scope: every offer starts with an email.
- Fixed hosting costs are roughly 50–60 EUR/month (database plan, VPS,
  email), covered by two or three small Cloud customers.
- As the Cloud operator we are a data processor for each customer. We need a
  DPA template and a public list of subprocessors (Supabase, the VPS host,
  the email provider) before the first contract.
- Supabase is a US company. EU hosting plus its DPA is lawful, but if "data
  that never leaves EU-owned infrastructure" becomes a selling point, the
  database should move to an EU-owned provider; nothing in LibreHR ties it
  to Supabase.
- Prices are easier to lower than to raise. Revisit them after the first
  customers, and when Cloud leaves early access.
