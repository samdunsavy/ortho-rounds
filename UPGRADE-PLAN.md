# Ortho Rounds — Path to 100%

**Written:** 2026-07-27 · **Baseline:** 27.4% (see `MARKET-POSITION.md`)
**Companion to:** `ROADMAP.md` (which this supersedes on sequencing)

---

## First, what "100%" has to mean

100% cannot mean "beat Epic." Epic holds 43.9% of hospital installations and has won Overall Health System Suite sixteen years running. Nobody wins that fight, and a plan that implies otherwise is a plan that fails at step one.

**100% = undisputed category leader of a wedge you define and own:**

> Offline-first rounds, handoff and post-op tracking for surgical training programmes in hospitals whose EHR does not reach the bedside.

That wedge is real, currently unowned, and defensible. There is no Best-in-KLAS category for rounding because rounding is a feature inside suites — which means no incumbent king to displace, and no procurement category you're being scored against. You get to define it.

100% in that wedge means, concretely:

1. 50+ paying departments across 15+ hospitals, at least 3 countries
2. The default answer when a surgical programme asks "what do we use for rounds?"
3. Compliance clearance that survives enterprise procurement without exceptions
4. A moat that isn't just "we built it well" — template network effects plus benchmarking data
5. Not dependent on one person

---

## The sequencing rule

Order is **not** by points. Order is by **dependency, then points-per-week.**

Compliance and interoperability are **gates, not line items** — below them you are not in the market at any product quality. Traction is a **dependency** — you cannot price, cannot prioritise, and cannot raise without it. Everything else is optimisation.

So the rule is:

> **Trust → Proof → Integration → Commercial → Certification → Moat → Enterprise**

Each stage has exit criteria. **Do not start stage N+1 until stage N's exit criteria are met**, even if N+1 is more fun. The failure mode this rule exists to prevent is the one visible in your own git log: three weeks of admin-console visual polish while interop, audit logging and second-user count all sat at zero.

---

## The trajectory

Every stage below moves specific Scorecard B dimensions. Arithmetic verified programmatically against the weights in `MARKET-POSITION.md`.

| Stage | Name | Duration | Score after | Δ | Δ/week |
|---|---|---|---:|---:|---:|
| — | Baseline today | — | **27.4%** | — | — |
| **1** | Trust foundations | 2 wks | **33.2%** | +5.8 | **2.90** ← highest |
| **2** | Proof | 4 wks | **37.5%** | +4.3 | 1.08 |
| **3** | Integration + scoping | 8 wks | **45.6%** | +8.1 | 1.01 |
| **4** | Commercial + DPDP + ops | 10 wks | **58.6%** | +13.0 | 1.30 |
| **5** | Certification + first paid | 22 wks | **71.5%** | +12.9 | 0.59 |
| **6** | Moat | 26 wks | **78.0%** | +6.5 | 0.25 |
| **7** | Enterprise | 26 wks | **91.3%** | +13.3 | 0.51 |
| **8** | Category leadership | 26 wks | **99.2%** | +7.9 | 0.30 |

Calendar with realistic overlap: **Stage 4 complete by end of 2026. Stage 5 through mid-2027. ~90% by late 2028. ~100% by 2029.**

One honest caveat: Stage 2 has the *second-lowest* Δ/week of the early stages, and it is still non-negotiably second. Its score delta understates it, because Stages 3–5 are all unbuildable without it. Proof isn't a points play, it's a key.

---

# Stage 1 — Trust foundations

**Now → 10 Aug 2026 (2 weeks) · Solo-doable · +5.8 points, the cheapest points on the board**

Everything here is a standing finding in any hospital security questionnaire, and all of it is small. This is why it goes first: two weeks converts security 3.0→6.5 and makes every later conversation possible.

| # | Work | Why now |
|---|---|---|
| 1.1 | **Audit log** — who viewed/edited/exported which patient, when. Extend the existing attribution stamping in `merge.js`; `moveHistory` is the pattern to generalise. | Table-stakes DPDP/HIPAA control. Also a hard dependency for Stage 2 — you cannot measure a design partner's usage without it. |
| 1.2 | **Security headers** — HSTS, CSP, X-Frame-Options, X-Content-Type-Options. Verified absent today. | Hours of work. Free points. |
| 1.3 | **Kill token-in-query-string** (`server.js:180–184`). Replace with short-lived signed image URLs. Add a short access token + refresh pair; the current 30-day bearer with no rotation is too blunt. | Tokens are currently landing in access logs, proxy logs, browser history and `Referer` headers. |
| 1.4 | **Gate the lab-photo AI flow.** Explicit per-use consent capture + a documented processor record, or ship an on-prem OCR path and make OpenAI opt-in. | This one feature sends identifiable patient images to a third-country processor. **It alone fails a DPDP review.** Do not let it reach a design partner ungated. |
| 1.5 | **Encryption at rest** for the hosted path (SQLite file encryption or Mongo CSFLE). Document self-host posture honestly as-is. | Without it the hosted tier cannot be shown to anyone with a compliance function. |
| 1.6 | **Split `app.js`.** 9,073 lines, ~7,300 untested. Extract 3–4 pure-logic modules and test them, following the pattern already working in `milestones.js`. | Not cosmetic — it's the precondition for a second engineer in Stage 4 being productive instead of dangerous. |

**Exit criteria:** audit log queryable per patient and per user · zero tokens in URLs · lab-photo flow consent-gated or local · security headers present · encryption-at-rest documented and enabled on hosted · `app.js` under 7,000 lines with the extracted modules tested.

---

# Stage 2 — Proof

**4 Aug → 7 Sep 2026 (4 weeks, overlapping Stage 1) · +4.3 points, and unlocks everything after**

The single highest-return item in the entire analysis. Traction scores 1.5/10. One real external user changes the character of every subsequent decision.

| # | Work |
|---|---|
| 2.1 | **Recruit one design partner outside your own ward.** Ideal: a different department in the same hospital *and* one department in a second hospital. Minimum viable: one. Target a surgical training programme with connectivity problems — that's where your offline architecture is not a feature but the reason to switch. |
| 2.2 | **Instrument a baseline before they start.** Time to complete rounds. Missed/late milestone rate. Handover duration. Minutes spent assembling the OT list. Measure the *current* paper/WhatsApp/spreadsheet process for one week first, or you will never have a before/after. |
| 2.3 | **30 days of daily use**, then measure again. Publish the delta internally as a one-page case study. |
| 2.4 | **Weekly 30-minute call with the actual PGs**, not the department head. The documented #1 cause of healthtech failure is founders who validated with chairs at conferences instead of the people inside the workflow. You have the rare inverse advantage — don't lose it by scaling before listening. |
| 2.5 | **Fix only what they hit.** Hard rule: no feature enters the backlog this stage unless a real user hit it. Everything else waits. |

**Exit criteria:** one non-you department using it daily for 30 consecutive days · a written before/after with at least two quantified metrics · a named clinician willing to be a reference · a ranked defect list authored by users, not by you.

**Kill criterion:** if after 60 days of genuine effort no external department will trial it free, the wedge thesis is wrong. Stop and re-examine the wedge before spending a year on Stages 3–5.

---

# Stage 3 — Integration + scoping

**24 Aug → 19 Oct 2026 (8 weeks) · +8.1 points**

Two structural problems, both of which get exponentially more expensive after the first paying multi-tenant customer.

### 3A — Kill double data entry (interop 0.5 → 4.0)

Data-entry burden scores **2/10** and is your largest product gap. Tools that don't integrate get abandoned regardless of quality — that is the most consistently documented failure pattern in the field.

| # | Work |
|---|---|
| 3.1 | **Read-only patient demographics + ADT ingest.** Start at whatever the design partner's hospital can actually emit: a nightly CSV drop, an HL7 v2 ADT feed, a database view. **The first integration matters more than the right integration.** Ship the ugly one. |
| 3.2 | **Read-only lab results ingest** from the same source. Labs score 6.5 and are fundamentally manual; the photo-extraction feature is clever compensation for a missing pipe. Build the pipe. |
| 3.3 | **A documented ingest contract** (one adapter interface, one adapter per site) so site #2 is configuration, not a fork. |

FHIR and ABDM are deliberately Stage 5. Do not build a standards-compliant integration before you have proven any integration removes the objection.

### 3B — Fix the multi-tenant scale wall (arch 4.0 → 7.0)

| # | Work |
|---|---|
| 3.4 | **Promote `orgId`/`unitId` to indexed columns** on `patients`. Today they live inside the JSON `data` blob — right call for one tenant, direct cause of 3.5. Write the migration now, while it's a migration and not an incident. |
| 3.5 | **Make scoping a database predicate.** `server.js:920–926` currently loads *every* changed row instance-wide and filters tenants in application memory. Two consequences: sync cost scales with total customers, not with the caller; and tenant isolation rests on one in-memory `.filter()` — one regression there leaks cross-org PHI. |
| 3.6 | **Move rate-limit state out of process memory** (`auth.js:10`). Process-local `Map` means two instances behind a load balancer = an inconsistent, effectively doubled limit. |
| 3.7 | **Load-test scoped sync** at 50 orgs × 200 patients. Establish the number before a customer establishes it for you. |
| 3.8 | **Cross-tenant isolation test suite** — an explicit adversarial suite that asserts org A can never see org B, at every endpoint. |

**Exit criteria:** one hospital's demographics and labs flowing in automatically, zero manual re-entry for those fields · scoped sync served by a database predicate with an index · isolation suite green · load test documented at 50 orgs.

---

# Stage 4 — Commercial + DPDP + operations

**12 Oct → 21 Dec 2026 (10 weeks) · +13.0 points — the largest early jump**

This is where a project becomes a company.

| # | Work | Moves |
|---|---|---|
| 4.1 | **DPDP compliance posture.** You are building an EMR-adjacent system for Indian hospitals, which makes you a **data fiduciary** — consent artifacts, data-processing record, DPIA, retention policy, breach-notification runbook, grievance officer. As of 2026 this is binding and immediate, not a Phase 2 aspiration. | compliance 2.5→6.0 |
| 4.2 | **Pricing and a real billing path.** Billing is currently a string in `flags.js`. Decide the unit (per-active-user vs per-bed), publish tiers, wire Stripe, and — critically — **charge the design partner something**, even a token amount. Free users tell you nothing about willingness to pay. | commercial 1.0→6.0 |
| 4.3 | **Deployability.** Docker image, IaC, health checks, structured logging, error tracking, uptime monitoring, a documented backup/restore drill you have actually rehearsed. Hospital IT resists tools that become their pet. | ops 2.0→6.0 |
| 4.4 | **Fix the bus factor.** 214 of 240 commits are yours; no second human reviewer exists. Fine at 32 days, existential at contract #1 and an automatic due-diligence flag. Hire or partner with one engineer, enforce PR review, write the onboarding doc. Stage 1.6 (`app.js` split) is what makes this hire productive rather than dangerous. | team 1.0→4.0 |
| 4.5 | **A support channel with a stated response time.** Even "email, 1 business day." Procurement asks. | ops |

**Exit criteria:** DPDP documentation pack complete and reviewed by an Indian privacy practitioner · published pricing · one invoice paid, however small · one-command deploy · monitoring alerting to a human · second engineer contributing reviewed PRs · restore drill rehearsed and timed.

---

# Stage 5 — Certification + first paid contracts

**Jan → Jun 2027 (22 weeks) · +12.9 points**

| # | Work | Moves |
|---|---|---|
| 5.1 | **Start the SOC 2 Type II clock in January.** It runs 9–18 months and costs $50k–$100k. HIPAA alone no longer passes enterprise hospital vendor security review. **Start it before the first enterprise conversation, not during** — this is the item most commonly discovered too late. | compliance 6.0→9.0 |
| 5.2 | **HIPAA readiness + BAA template** if any US or US-adjacent customer is in scope. Must exist *before* the first contract touching PHI. | compliance |
| 5.3 | **Now build FHIR read** (Patient, Encounter, Observation, DiagnosticReport) and get listed in **Epic Showroom Connection Hub** (~$500/yr — trivially cheap, and being absent is itself a procurement negative). Note App Orchard and App Market are both retired; anyone telling you to list there is working from stale information. | interop 4.0→7.5 |
| 5.4 | **ABDM integration.** 50+ services are already integrated including Bahmni, DocOn and EkaCare. In India non-integration is becoming a procurement negative, and it is also the cheapest credibility you can buy in that market. | interop |
| 5.5 | **Independent penetration test** and remediation. | security 6.5→8.5 |
| 5.6 | **Convert to 5+ paying departments across 3+ hospitals.** Reference-selling off the Stage 2 case study. | traction 5.0→8.0 |

**Exit criteria:** SOC 2 Type II audit window open · pen test remediated · FHIR read live at one site · ABDM integration certified · 5 paying departments, 3 hospitals · one contract signed by a hospital administrator rather than a department head.

---

# Stage 6 — Moat

**Apr → Dec 2027 (26 weeks, overlapping Stage 5) · +6.5 points**

Everything so far is copyable. Moat 4.0/10 is the honest read: offline-first and specialty depth are real advantages but reproducible by a funded competitor in six months. This stage builds the parts that compound.

| # | Work | Moves |
|---|---|---|
| 6.1 | **Generalise the template engine.** The hook already exists — `departments.specialty`, currently defaulting to `'ortho'` (`storage.js:152`). Make general surgery, neurosurgery, trauma and medicine run as *templates on the same substrate*, never forks. Then let departments author and share their own. **A template library other departments contribute to is the first thing here with a network effect.** | moat 4.0→8.0 |
| 6.2 | **Consented, de-identified benchmarking.** Opt-in per hospital, off by default, self-host never pooled. "How does my length of stay compare to 40 similar departments?" is a question no competitor can answer without the same cohort — and it's the only genuine data moat available to you. | moat |
| 6.3 | **Close the mobile gap.** Native shell or a serious PWA pass: biometric login, real device testing on the touch surfaces your own `POLISH.md` flags as untested, background sync. This is where "best out there" perception is won or lost. | product 8.5→9.5 |
| 6.4 | **Finish `app.js` coverage** and add an E2E layer. None exists today. | product |
| 6.5 | **Expand to 20+ departments**, 2+ countries. | traction 8.0→9.0 |

**Exit criteria:** 3+ specialty templates live and in production use outside ortho · a department-authored template adopted by another department · first benchmarking cohort with 5+ consented hospitals · E2E suite in CI · 20 paying departments.

---

# Stage 7 — Enterprise

**Jan → Sep 2028 (26 weeks) · +13.3 points → 91.3%**

| # | Work |
|---|---|
| 7.1 | **SSO/SAML + SCIM provisioning.** Non-negotiable for hospital IT above a certain size. |
| 7.2 | **Full RBAC.** Only `admin`/`member` exist today. Attending, PG, nurse (ward-scoped), read-only auditor, and delegated org admin. The nurse role in particular is a known future need. |
| 7.3 | **High availability** — multi-instance, managed Postgres or sharded Mongo, connection pooling, zero-downtime deploys, a real RPO/RTO commitment. |
| 7.4 | **EHR write-back** where permitted (notes, plans) — read-only got you in the door, write-back makes removing you painful. |
| 7.5 | **Enterprise support tier** — SLA, named contact, onboarding programme, training material. |
| 7.6 | **Team to 5–8 people**, on-call rotation, security officer named. |
| 7.7 | **International compliance variants** — HIPAA, DPDP, GDPR as the customer base spreads. |

**Exit criteria:** SSO live at 2+ enterprise sites · documented HA with a tested failover · 99.9% SLA offered and met for two consecutive quarters · one enterprise contract signed through formal procurement · no single person's absence blocks a release.

---

# Stage 8 — Category leadership

**Late 2028 → 2029 · +7.9 points → ~100%**

The remaining points are not engineering. They are: 50+ departments across 15+ hospitals and 3+ countries; published peer-reviewed outcome data (the thing that makes you citable rather than sellable); a training-programme partnership or accreditation-body endorsement; the template ecosystem as a genuine switching cost; and being the default answer to "what do we use for rounds?"

---

## The stop-list

Explicitly do **not** do these, in this order of temptation:

1. **More admin-console visual polish.** It has had four consecutive passes. It is done. The next commit touching it should be a bug fix a user reported.
2. **More AI features.** Nine endpoints already exist. Abridge has raised ~$812M, is at a $5.3B valuation, sits in 250+ health systems, and is #1 Best in KLAS for ambient AI two years running. Ambient documentation revenue went from under $200M in 2022 to an estimated $5B+ by end of 2026. **You will never win on AI drafting, and positioning on it invites a comparison you lose.** Your nine features are table stakes to keep, not a differentiator to extend.
3. **Building FHIR before building any integration.** Standards-compliance before proof of value is a nine-month detour.
4. **Rewriting in a framework.** Three runtime dependencies is an asset. Nothing in Stages 1–8 requires React.
5. **Marketing before Stage 2 exit.** You currently have nothing to say that a hospital would believe.
6. **Pursuing a hosted multi-tenant customer before Stage 3B.** The scoping bug is a PHI-leak vector; onboarding tenant #2 onto it converts a bug into a breach.

---

## Next 14 days — concrete

Ordered. Roughly one item per day, with slack.

1. Audit-log schema + write path, extending `merge.js` attribution
2. Audit-log read API + admin console view
3. Security headers + a test asserting each is present
4. Short-lived signed image URLs; delete the `?token=` fallback
5. Access/refresh token split; drop the bare 30-day bearer
6. Consent gate on the lab-photo flow + processor record written down
7. Encryption at rest on the hosted path
8. **Send three design-partner emails.** Do not wait for Stage 1 to finish — this is the longest-lead item in the entire plan and it starts today.
9. Extract module 1 from `app.js` + tests
10. Extract module 2 from `app.js` + tests
11. Baseline-measurement instrument for the design partner (the before, before there's an after)
12. Speed up the test suite — four admin jsdom suites currently push it past 5 minutes
13. Cross-tenant isolation test suite (early, cheap, and it protects Stage 3B)
14. Stage 1 exit review against its criteria; then start Stage 2 properly

---

## How to hold yourself to this

- **Review monthly against the scorecard in `MARKET-POSITION.md`,** not against a feature list. If a month produced no dimension movement, that month was polish.
- **One number on the wall per stage.** Stage 2: days of external daily use. Stage 3: manual fields eliminated. Stage 4: rupees invoiced. Stage 5: paying departments.
- **The velocity trap is the main risk.** 240 commits in 32 days is exceptional and it is *why* three weeks went into visual polish while interop sat at zero. Stages 1–4 are mostly unglamorous. Ship them anyway.
