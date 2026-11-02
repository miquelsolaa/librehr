# CLEANROOM.md - Independent implementation policy

LibreHR is an **independent** implementation of generic HR-software functionality. Functionality (what an HRIS does) is not owned by anyone.
Expression (code, UI artwork, text, brand) is. This policy keeps the project on the right side of that line and makes it provable.

> This document is an engineering policy, not legal advice. Have an IP lawyer review it before the first public release.

## 1. What we build from (allowed sources)

- Public law and official guidance (Estatuto de los Trabajadores, RGPD, LOPDGDD, BOE, AEPD, Inspeccion de Trabajo, Seguridad Social).
- Generic HR domain knowledge: textbooks, standards, collective-agreement templates, public HR glossaries.
- Our own requirements in `PRD.md`, our own personas in `PERSONA.md`, and interviews with real users who consented to share their needs.
- Open-source projects **under licenses compatible with AGPL-3.0**, used according to their license, with attribution in `NOTICE`.
- Public file formats and protocols (CSV, iCalendar, PDF, SEPA, official Spanish formats).

## 2. What we never use

- Source code, decompiled or deobfuscated code, leaked code, or private repositories of any commercial HR product.
- Screenshots, screen recordings, UI copy, help-center text, email templates, icons, illustrations, or layouts of commercial HR products as a _reference to reproduce_.
- Data scraped from, or obtained through automation of, any third-party product; its private APIs; or its database schema obtained by reverse engineering.
- Confidential information from any current or former employer, contractor, or customer of a competing product.
- Any account, trial, or credentials used in violation of the product's terms of service.

## 3. Practical rules for contributors and agents

1. Write requirements in your own words from the allowed sources. If a requirement came from "how another product does it", rewrite it from the user's goal and the law, and cite the source of the rule.
2. Design UI from `DESIGN.md` tokens and our own wireframes. Do not open a competitor's app "for inspiration" while building a screen.
3. Name things after the domain, not after a product. Do not use competitor brand names in code, identifiers, UI, or marketing, except in neutral comparison pages reviewed by a maintainer.
4. Import/migration features may read **user-exported files** (CSV/XLSX the customer downloads themselves). They must not log into, scrape, or call private endpoints of other products.
5. If you have previously worked on, or had access to the internals of, a competing product, tell a maintainer before contributing to the related module. We may ask you to avoid it.
6. AI agents are bound by the same rules. An agent must not be given competitor material in its context, and must not be asked to "replicate" a named product.

## 4. Evidence trail

- Every PRD requirement lists its basis in a `Source:` line (law article, standard, user interview id, or "domain convention").
- Every PR includes the attestation below.
- Design decisions that look similar to well-known patterns (calendars, timesheets, org charts) are documented in an ADR when they are non-obvious.
- Keep this file and the PR template under maintainer review; changes require two approvals.

## 5. PR attestation (copied into the PR template)

- [ ] I wrote this code/text/design myself or generated it from this repository's requirements.
- [ ] I did not copy or closely paraphrase code, copy, assets, or layouts from a commercial HR product.
- [ ] I did not use scraping, reverse engineering, or credentials outside our terms.
- [ ] Any third-party code or asset is listed in `NOTICE` with a compatible license.
- [ ] I disclosed any prior exposure to a competing product's internals to a maintainer.

## 6. If a problem is found

Stop work on the affected files, tell a maintainer, and do not delete history. Maintainers assess, remove or rewrite the affected material from a clean source, and record the incident in `docs/incidents/`.
