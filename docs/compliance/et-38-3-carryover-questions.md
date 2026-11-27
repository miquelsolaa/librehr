# ET art. 38.3 and vacation carry-over: questions for labour counsel

Status: **open, pending legal review** (issue #133, `LEA-002`, `LEA-005`,
`COMPLIANCE.md` §6 and §7). Last updated 2026-11-26.

This note lists what LibreHR does today when a leave policy turns on
`carryover_enforced`, and the questions labour counsel must answer before
LibreHR recommends enforcement or changes the protection rules. It is not
legal advice. The descriptions of the law below are paraphrased from generic
public-law knowledge and **must be checked against the current consolidated
text** of the Estatuto de los Trabajadores (ET).

## Interim stance

- Enforcement stays **off by default**. While it is off, nothing is
  forfeited or expired, and the questions below do not matter.
- An administrator can still turn it on per policy. Since #133 the settings
  page asks for an explicit acknowledgement first, and shows a "pending legal
  review" notice on every enforced policy. The acknowledgement is UI-only;
  the change is audited (`leave.policy.update`, previous and new values).
- The protection rules are not changed until counsel answers. Follow-up work
  on #133: automatic restoration of days when leave is approved after a
  close, a neutral in-app HR notification (after Q8), then the rule changes
  counsel asks for.

## What the code does today (enforced policy only)

- **Close of year N** (January run of `leave.accrue`): for each employee and
  leave type with a policy, the year-end balance B is split into carried
  C = min(B, `carryover_max_days`) and forfeited F = B - C. Carried days get
  an expiry date: the last day of month `carryover_expiry_months` (1..12) of
  N+1.
- **Expiry**: after that date, carried days not used since 1 January expire.
- **ET 38.3 shield** (`protectsVacation` in `packages/core`): an employee
  with **approved** protected leave overlapping year N-1 or N keeps their
  whole balance at the close of N, with no expiry date, for every enforced
  leave type. Protected leave between 1 January and the expiry date also
  cancels the expiry. Protected leave in year N therefore shields the closes
  of N and N+1; days from N can first be capped at the close of N+2.
- **Protected codes**: `sick_leave`, `temporary_incapacity`,
  `pregnancy_risk`, `prenatal_exams`, `maternity`, `paternity`,
  `birth_childcare`, `adoption`, `breastfeeding`, `breastfeeding_risk`. Any
  other leave type that is not an entitlement of the employee also protects,
  unless its code is a known ordinary permit. `parental_leave` and
  `parental_leave_unpaid` (ET 48 bis) are treated as ordinary.
- **Timing**: only requests approved when the job runs count. Leave approved
  later is ignored; HR restores the days with an adjustment.
- **Reporting**: an ids-only log line ("statutory exemption") and job-report
  counts. No in-app notification.
- **No employer-diligence record**: LibreHR does not record that the
  employer invited the employee to take the days or warned them of the loss.

## Law as we understand it (to confirm)

- ET 38.3, second paragraph: when the fixed vacation period coincides with
  temporary incapacity arising from pregnancy, childbirth or natural
  breastfeeding, or with the contract suspensions of ET art. 48 for birth,
  adoption or foster care, and risk during pregnancy or breastfeeding, the
  worker may take the vacation on other dates after the suspension ends, even
  if the calendar year has ended. No explicit time limit. The sub-paragraph
  numbers of art. 48 need checking after the RDL 6/2019, RDL 5/2023 and later
  amendments.
- ET 38.3, third paragraph: when the vacation period coincides with
  temporary incapacity from other causes that prevents taking it, totally or
  partially, in its year, the worker may take it after the incapacity ends,
  provided no more than 18 months have passed from the end of the year in
  which it accrued.

## Questions

1. **Scope of situations.** Which leave triggers ET 38.3?
   1. Is the ET 48 bis parental leave (paid or unpaid) covered? The code
      treats it as ordinary.
   2. Is the ET 37.3.f prenatal exams permit covered? The code protects it,
      on the safe side.
   3. Are these covered: suspension for gender violence, extensions for
      premature or hospitalised newborns, incapacity from a work accident or
      occupational disease (covered today through `sick_leave`), and
      excedencia for childcare (not protected today)?
   4. Is `paternity` the same as the ET 48.4 birth suspension of the other
      parent?
2. **Trigger condition.** The law speaks of coincidence with the fixed
   vacation period, or incapacity preventing the vacation. The code protects
   whenever any protected leave overlaps the year or the year before, of any
   length. Is this deliberate over-protection lawful and acceptable? Does it
   leave a gap, for example incapacity starting during a vacation already in
   progress (CJEU case law), or vacation scheduled after an incapacity that
   ended in December?
3. **Time limits.**
   1. Ordinary incapacity: the code keeps days until the close of N+2
      (about 24 months, against the statutory 18). Is that acceptable, or
      must the loss happen at 18 months? Could it breach a collective
      agreement?
   2. Birth, adoption, pregnancy and breastfeeding situations have no
      explicit limit. Is there an implied deadline after return (for example
      the year of return)? With chained leave (birth, then breastfeeding
      risk, then excedencia, returning in N+3), may the N days be capped at
      the close of N+2, as the code would do?
4. **Retroactive recognition.** Incapacity is often registered or approved
   after 31 December. Is a forfeit written before that void, and must it be
   reversed automatically, or is HR remediation on request enough?
5. **Employer diligence.** Under CJEU C-684/16 (Max-Planck) and C-619/16
   (Kreuziger) and the Spanish case law following them, can days be lost if
   the employer cannot show it gave the worker the opportunity to take them
   and warned them of the loss? Must enforcement depend on a recorded
   per-employee notice?
6. **Cap legality.** ET 38 sets no carry-over cap; collective agreements
   regulate carry-over. Is applying an agreement's cap to non-protected days
   lawful? When the agreement is silent, should the default be "carry
   nothing" or "carry everything" (LibreHR carries everything)?
7. **Termination.** Employees who leave before 31 December are not closed
   and are settled in money (ET 38.1). Must protected days forfeited earlier
   be included in the settlement?
8. **Data protection.** Does an HR notification saying "carry-over limit not
   applied (statutory exemption)" for a named employee reveal special-category
   data (health or pregnancy) by inference? Must it be limited to roles that
   can already see absence types?

## After counsel answers

Record the answers and their date here and in `docs/compliance/changelog.md`,
update `COMPLIANCE.md` §6, `docs/guides/leave-accrual.md` and the rule in
`packages/core/src/leave/protected-leave.ts`, and tick the vacation item of
the §7 lawyer review. A per-type protection flag, a per-entry protected
marker or an employer-notice feature needs a schema change and its own plan.
