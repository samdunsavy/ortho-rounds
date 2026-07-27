# Ortho Rounds — Market Position Analysis

**Date:** 2026-07-27 · **Analyst view:** CEO-level, adversarial
**Question asked:** what percentage of the way to "best in the market" is this project?

---

## Headline answer

| Lens | Score | What it means |
|---|---|---|
| **Product capability** for the specific job (surgical-resident ward rounds) | **65%** | The clinical engine is real and in places genuinely better than the incumbents |
| **Business/market readiness** (compliance, interop, traction, capital) | **11%** | Almost nothing that turns a product into a company exists yet |
| **Blended position vs. category leader** | **≈28%** | Roughly one-quarter of the distance |

The blunt version: **you have built ~65% of a very good product and ~11% of a company.** The remaining 72% of the gap to "best in market" is mostly *not code*. That is the single most important finding in this document.

---

## Part 1 — What actually exists (verified, not from docs)

Measured directly against the repo, not the README.

**Scale and velocity**

- First commit **2026-06-25**, latest **2026-07-27** → **32 days old**
- **240 commits**, effectively **one human author** (214 commits) plus agent-assisted commits
- **~24,500 LOC** server-side JS; **13,855 LOC** front-end (`app.js` alone is 9,073 lines; `index.html` 2,435; admin console split across 4 modules ≈1,630)
- **579 test cases across 167 suites**, GitHub Actions CI on push/PR
- Test health: I sampled 161 tests across backend logic, server scoping, sync-golden, and front-end suites — **161/161 passing, 0 failures**. Full-suite wall time exceeds 5 minutes in a constrained environment, which is itself worth fixing (the four large admin front-end jsdom suites dominate it).

**Runtime dependencies: three.** `docx`, `mongodb`, `web-push`. No framework, no bundler, no ORM. That is an unusual and defensible engineering choice for a self-hosted tool — it is also part of why the scale ceiling is where it is (see Part 4).

**Shipped clinical surface**

- Four views: Rounds, Worklist, OT list, Discharged
- Offline-first PWA: service worker + IndexedDB cache, works with no connection
- Field-aware sync merge with per-item checklist reconciliation, independent field timestamps (`planUpdatedAt`, `statusUpdatedAt`), and explicit conflict surfacing rather than silent overwrite
- Milestone/POD engine with overdue / due / upcoming bucketing — specialty-tuned day arithmetic, fully tested
- "Start here" triage ranking across ~11 clinical reason types
- Labs trend view + photo-to-labs extraction; X-ray upload with pinch/zoom viewer
- Presentation mode with a large-text variant for projector/wall-display reading
- OT list → server-generated `.docx` matching a real department template; handover sheet print export
- Push notifications, export/import, rolling 7-copy backups, raw SQLite backup endpoint
- **Nine AI endpoints:** draft plan, polish presentation, handover summary, discharge summary, ward brief, ward risk flags, bedside scribe, WhatsApp admission parsing, lab-photo extraction

**Shipped platform surface**

- Per-user accounts: `scrypt` hashing, HMAC-SHA256 signed tokens, timing-safe comparison, per-IP+username login rate limiting, token-version revocation (disable = instant logout everywhere)
- Pluggable storage: `node:sqlite` or MongoDB, mirrored CRUD
- `org → hospital → department → unit → ward` hierarchy with subtree scoping, behind `ORTHO_FLAG_MULTI_TENANT`
- Admin console: orgs master-detail, structure tree, people management, bulk assignment, patient rehome, ancestry repair
- Versioned sync contract (`/api/sync/v1`), feature-flag layer, written backward-compatibility and deprecation policy, opt-in local telemetry
- Per-patient `moveHistory` audit trail on structural moves
- Spec-driven development discipline: 16 design docs + 19 implementation plans in `docs/superpowers/`

That last point deserves emphasis. **The process quality here is above the median funded seed-stage healthtech startup.** Versioned API before it was needed, a written no-breaking-change policy, a flag layer built before the features that need it, WCAG contrast ratios computed with the actual luminance formula rather than eyeballed. That is not normal at 32 days.

---

## Part 2 — What the market actually looks like

### The incumbent reality

- **Epic holds 43.9% of hospital installations**; Epic + Oracle Cerner together exceed **62% of the US inpatient EHR market**.
- Epic won **Overall Health System Suite for the 16th consecutive year** in the 2026 Best in KLAS awards, plus Best in KLAS in **11 market segments**.
- Epic's mobile apps (**Rover, Haiku, Canto**) already ship patient list management, handoff, MAR, vitals, specimen collection, secure chat, and photo capture. Epic **Secure Chat** is unified across Hyperspace and mobile.

**There is no standalone "Best in KLAS: rounding" category.** Rounding is a *feature inside a suite*, not a market with its own leader. This is the most strategically important fact in this analysis, and it cuts both ways:

- **Against you:** there is no category crown to win. "Best rounding tool" is not a thing hospitals procure.
- **For you:** there is also no entrenched category king to displace. The competitive field is genuinely thin.

### The direct comparables

| Player | Position | Relevance |
|---|---|---|
| **Epic Rover / Haiku / Canto** | Inside 43.9% of hospitals | Free-at-the-margin to any Epic site. Your real competitor is "the thing they already have." |
| **TransformativeMed CORES** | Rounding + I-PASS handoff *on top of* Epic | Closest functional analogue. Note the model: they augment Epic rather than replace it. |
| **eDocList** | Physician-built handoff list, live since **2007** | Nineteen years of a physician-built handoff list existing has not produced a category winner — evidence the pure-handoff wedge is hard to monetize alone. |
| **TigerConnect** | **7,000+ healthcare entities**, in Epic Toolbox | Owns clinical messaging; expanded into AI scheduling intelligence in June 2026 |
| **Bahmni (India)** | Free open-source HMIS, **100+ hospitals**, ABDM-integrated | Your most dangerous competitor in the Indian market, because the price is zero |

### Where the money and momentum actually are

- **Ambient AI documentation** went from **<$200M revenue in 2022 to an estimated $5B+ by end of 2026**. **>70% of large IDNs** have deployed or are piloting an ambient scribe.
- **Abridge:** ~**$812M raised**, **$5.3B valuation**, **250+ health systems**, #1 Best in KLAS for ambient AI two years running.
- **Suki:** $70M Series D, 300+ health systems. **Nabla:** ~$44.7M raised.
- **Clinical communication & collaboration** market: **~$3.3–3.45B in 2026**, forecast **~$7.4B by 2032**.

Your nine AI features sit adjacent to a category where a competitor has raised 812 million dollars. That is not a reason to stop — but it is a reason to never position AI drafting as your differentiator.

### The compliance gates, priced

- **SOC 2 Type II: 9–18 months, $50k–$100k.** Increasingly a hard gate: HIPAA alone no longer passes enterprise hospital vendor security review.
- **HIPAA + signed BAA must exist *before*** the first contract touching PHI.
- **India's DPDP Act 2023 + 2025 Rules:** health data is sensitive personal data requiring explicit informed consent; every hospital, clinic, diagnostic centre, telemedicine platform and **EMR system is a data fiduciary**. As of 2026 this is described as binding and immediate, not aspirational. Any EMR-adjacent product serving Indian hospitals inherits fiduciary-grade obligations.
- **ABDM:** 50+ digital health services already integrated (Bahmni, DocOn, EkaCare among them). Non-integration is becoming a procurement negative in India.

### Why point solutions die (documented failure patterns)

Every one of these applies to you today:

1. Tools that don't integrate into the established workflow get abandoned regardless of quality.
2. **User ≠ buyer ≠ payer.** Your user is a PG. Your buyer is a department head. Your payer is hospital admin. You have built beautifully for exactly one of the three.
3. Hospitals buy integrated suites; displacing one component requires clinical superiority a single-feature product can rarely demonstrate.
4. Hospital IT resists anything that adds maintenance burden or doesn't talk to the EHR.
5. Founders talk to department chairs at conferences instead of the frontline. (You have the inverse advantage here — you *are* the frontline. Don't waste it.)

---

## Part 3 — The scorecard

### Scorecard A: product capability for the job → **65.2%**

Scored against a hypothetical best-in-class rounds tool, not against Epic-the-suite.

| Dimension | Weight | Score | Weighted | Evidence |
|---|---:|---:|---:|---|
| Data-entry burden / integration | 12 | 2.0 | 24.0 | Everything is typed twice. No lab feed, no ADT, no demographics import. **This is the #1 adoption killer.** |
| Handoff / sign-out | 12 | 7.0 | 84.0 | Handover sheet + AI summary; no I-PASS structure, no receiver acknowledgement, no handoff audit |
| Worklist / triage | 12 | 8.5 | 102.0 | "Start here" ranking across 11 reason types — better than a flat Epic patient list |
| Milestone / POD tracking | 10 | 9.0 | 90.0 | Specialty-tuned, fully tested, genuinely differentiated |
| Offline reliability | 8 | 8.5 | 68.0 | Real edge. Epic Rover assumes connectivity; you assume it fails |
| Mobile UX | 8 | 7.5 | 60.0 | Strong PWA, but no native app, no biometric login, device testing incomplete |
| Labs | 8 | 6.5 | 52.0 | Photo extraction is clever; still fundamentally manual |
| Document output | 8 | 8.0 | 64.0 | Real department OT template as `.docx`; handover print |
| Vitals / meds / orders | 8 | 1.0 | 8.0 | **Absent.** Verified: no vitals, no MAR, no order entry, no consent module |
| Imaging | 5 | 7.0 | 35.0 | Upload + zoom viewer; not PACS/DICOM |
| Roles / scoping | 5 | 6.5 | 32.5 | Node-based subtree scoping shipped; only admin/member roles exist |
| Accessibility / print | 4 | 8.0 | 32.0 | WCAG ratios actually computed; print bug found and fixed |
| **Total** | **100** | | **651.5** | **65.2%** |

### Scorecard B: company / market readiness → **27.4%**

| Dimension | Weight | Score | Weighted | Evidence |
|---|---:|---:|---:|---|
| Interoperability (FHIR / HL7 / ABDM) | 12 | 0.5 | 6.0 | **Zero.** No FHIR, no HL7, no ABDM, not listed in Epic Showroom |
| Compliance & certification | 12 | 1.0 | 12.0 | No HIPAA program, no BAA, no SOC 2, no DPDP consent artifacts or DPIA |
| Product depth | 15 | 7.0 | 105.0 | Per Scorecard A |
| Differentiation / moat | 10 | 4.0 | 40.0 | Offline + specialty templates are real but copyable. No data moat, no network effect, no integration lock-in |
| Architecture scalability | 10 | 4.0 | 40.0 | See Part 4 — hard ceiling identified |
| Security posture | 10 | 3.0 | 30.0 | Good primitives, missing controls (Part 4) |
| Commercial engine | 10 | 1.0 | 10.0 | Billing is a flag name in `flags.js`. No pricing, no tiers, no contract, no sales motion |
| Market validation / traction | 10 | 1.5 | 15.0 | One home ward at best. No named design partner, no second site, no published outcome data |
| Ops maturity | 5 | 2.0 | 10.0 | Render blueprint only. No Docker, no IaC, no monitoring, no SLA, no on-call, no support channel |
| Team & capital | 6 | 1.0 | 6.0 | Solo, unfunded, vs. an $812M-raised adjacent competitor |
| **Total** | **100** | | **274.0** | **27.4%** |

**Business-only sub-score** (compliance + interop + commercial + traction + team + ops, renormalised): **10.7%**.

### Blended

Weighting product and company equally as "best in market" implies both: **(65.2 + 27.4) / 2 ≈ 46%** is too flattering, because a product nobody can legally buy scores zero in the market regardless of quality. Weighting company readiness at 60% (the market decides, not the code) gives:

> **0.4 × 65.2 + 0.6 × 27.4 ≈ 42.5%** — optimistic ceiling
> **Realistic position: ~28%**, because interop and compliance are *gates*, not weighted line items. Below the gate you are not in the market at all, at any product quality.

---

## Part 4 — Hard technical findings (the ones that matter commercially)

These are not style notes. Each one is a thing a hospital security review or a scale event will surface.

**1. The multi-tenant sync path does not scale and is an isolation risk.**
`server.js:920–926` — `store.getChangedSince(since)` fetches **every** changed patient row instance-wide, maps them all to objects, *then* filters by scope in application memory. In a hosted multi-tenant deployment, every tenant's sync reads and deserialises every other tenant's changed records. Two consequences: (a) sync cost grows with total customers, not with the caller's ward; (b) tenant isolation depends entirely on one in-memory `.filter()` — a single regression there leaks cross-org PHI. This needs to become a database-level predicate before the first paying multi-tenant customer, not after.

**2. Patient scoping fields are unindexed and unqueryable.**
The `patients` table is `(id, updatedAt, deleted, data TEXT)`. `orgId`/`unitId` live inside the JSON blob — a deliberate, documented choice to avoid migrating the largest table. It was the right call for a single tenant. It is the direct cause of finding #1, and it blocks any scoped query, any per-org reporting, and any benchmarking feature from Phase 3. This is the highest-leverage schema decision left in the codebase.

**3. Bearer tokens in query strings.**
`server.js:180–184` accepts `?token=` because `<img>` tags can't set an Authorization header. Understandable, but tokens then land in access logs, proxy logs, browser history and `Referer` headers — with a **30-day TTL and no refresh/short-lived pair**. Fix: short-lived, single-image signed URLs.

**4. No security headers at all.**
Verified absent: HSTS, CSP, X-Frame-Options, X-Content-Type-Options. Free to add, and their absence is a standing finding in any vendor security questionnaire.

**5. No audit log.**
`moveHistory` covers structural patient moves — good. But there is no who-viewed/who-edited-what-when log. This is a **Phase 2 blocker and a DPDP/HIPAA table-stakes control**, not a nice-to-have.

**6. No encryption at rest.** Documented as a Phase 2 intent. Until then, the hosted tier cannot be offered to anyone with a compliance function.

**7. In-memory state blocks horizontal scaling.** Login rate-limit buckets live in a process-local `Map` (`auth.js:10`). Two instances behind a load balancer = the rate limit is effectively doubled and inconsistent. Same pattern will bite for AI rate limiting.

**8. The lab-photo AI flow sends patient-identifying images to OpenAI.** Honestly documented in the README as the one exception where an image leaves the server. Under DPDP that is a cross-border transfer of sensitive personal data to a third-party processor without a BAA-equivalent. **This single feature is enough to fail a compliance review.** It needs consent capture, a processor agreement, or an on-prem OCR path before any real-PHI deployment.

**9. ~7,300 lines of `app.js` remain untested.** Your own `POLISH.md` says so, and it's still true. The most-changed file in the repo has partial coverage. No E2E/headless-browser layer exists at all.

**10. Single-author bus factor.** 214 of 240 commits from one person, no second human reviewer. At 32 days this is fine. At the first hospital contract it is an existential operational risk and a due-diligence red flag.

---

## Part 5 — Where you are genuinely ahead

Being adversarial above earns the right to be precise here. Four real advantages, in order of durability:

1. **Offline-first is a structural edge, not a feature.** Epic Rover assumes connectivity. Your entire sync architecture assumes it fails — field-level timestamps, per-item checklist merge, explicit conflict surfacing. In an Indian government-hospital ward with patchy Wi-Fi, this is not a nice-to-have, it is the difference between usable and unusable. Incumbents cannot cheaply retrofit this; it's an architectural commitment, not a toggle.

2. **You are the user.** The OT list matches a real department's Word template, column for column. Default operating team names are pre-filled. POD arithmetic reflects how a PG actually thinks about post-op day. The documented #1 cause of healthtech failure is founders who talked to chairs instead of the frontline. You have the opposite problem, and it shows in the product.

3. **Specialty-depth in an unserved niche.** Nobody is competing for "orthopaedic residency ward rounds in a resource-constrained hospital." Generic rounding modules give you a checklist template; you give POD-aware milestone bucketing, antibiotic-stop tracking, and fitness-for-surgery flags. In this thin field you are plausibly already at 65–70% of the best available option — because the best available option is a spreadsheet, a WhatsApp group, or a paper list.

4. **Engineering discipline that buys optionality.** Versioned API, feature flags, written compat policy, 579 tests, spec-then-plan-then-implement. Most 32-day products have accrued the technical debt that makes Phase 2 impossible. Yours has not. That is worth real months later.

---

## Part 6 — What actually closes the gap

The 72 points you are missing do not come from more features. Ranked by points-per-unit-effort:

**Tier 1 — gates. Nothing else counts until these clear.**

1. **One named design partner beyond your own ward.** A second department, ideally a second hospital, using it daily for 30 days with a written before/after — time-to-complete-rounds, missed-milestone rate, handover time. This converts "well-built" into "proven," and it is the input to every conversation that follows. Highest single-item return in this document. Traction currently scores 1.5/10.
2. **A DPDP compliance posture.** Consent artifacts, a data-processing record, a DPIA, and a decision on the lab-photo flow. You are building an EMR-adjacent system for Indian hospitals; you are a data fiduciary. This is not a Phase 2 item any more.
3. **Audit logging + encryption at rest + security headers.** Roughly two weeks of work that moves security from 3/10 to ~6/10 and unblocks every compliance conversation.

**Tier 2 — structural.**

4. **Fix the sync scoping query** (findings #1 and #2). Promote `unitId`/`orgId` to indexed columns; make scoping a database predicate. Do this before the first multi-tenant customer, while it's a migration and not an incident.
5. **One integration, done properly.** Read-only ADT/demographics ingest — even a CSV or HL7 file drop — kills the double-data-entry objection, which is your single largest product gap (2/10) and the documented #1 reason tools like yours get abandoned. FHIR/ABDM later; the *first* integration matters more than the *right* integration.
6. **Pick the wedge and say it out loud.** "Offline-first, specialty-tuned rounds and handoff for surgical training programmes in hospitals whose EHR doesn't reach the bedside." Never position against Epic's feature list; never position AI drafting as the differentiator — Abridge has $812M and 250+ health systems in that lane.

**Tier 3 — commercial.**

7. Pricing and a billing path (currently 1/10 — a flag name).
8. Docker + IaC + monitoring, so a hospital IT department can say yes without adopting you as a pet.
9. SOC 2 readiness sequencing — begin the 9–18 month, $50–100k clock *before* the first enterprise conversation, not during it.

---

## Bottom line

**~28% of the way to best-in-market**, composed of a **65%-complete product** and an **11%-complete company**.

The unusual thing about your position is *which* 28%. Most projects at this stage have the reverse problem — a pitch deck, a pilot, a waitlist, and a prototype that falls over. You have a real, tested, architecturally disciplined system and no commercial apparatus whatsoever. That asymmetry is fixable in a way the reverse is not; you cannot retrofit engineering discipline into a product that was rushed, but you can absolutely add compliance, integration and proof to one that wasn't.

The trap to avoid is the one your own velocity sets for you: 240 commits in 32 days is exceptional, and it is also the reason the last three weeks went into admin-console visual polish while interop, audit logging, and a second user sat at zero. **The next 30 days should contain less code than the last 30.**

---

## Sources

- [Epic Market Share 2026 — Folio3 Digital Health](https://digitalhealth.folio3.com/blog/epic-market-share/)
- [Most common inpatient EHR systems by market share — Definitive Healthcare](https://www.definitivehc.com/blog/most-common-inpatient-ehr-systems)
- [Best in KLAS 2026 winners — Becker's Hospital Review](https://www.beckershospitalreview.com/healthcare-information-technology/ehrs/best-in-klas-2026-whos-winning-in-ambient-ai-ehrs-revenue-cycle-and-more/)
- [Best in KLAS 2026 — Healthcare IT News](https://www.healthcareitnews.com/news/best-klas-2026-sees-positive-disruption-tangible-tech-improvements)
- [2026 Best in KLAS Awards full list — HIT Consultant](https://hitconsultant.net/2026/02/04/2026-best-in-klas-winners-full-list-software-services/)
- [Epic Rover features guide — Mindbowser](https://www.mindbowser.com/epic-rover-guide/)
- [Epic Secure Chat — University of Iowa Epic Education](https://epicsupport.sites.uiowa.edu/epic-resources/secure-chat)
- [Epic EHR Integration Guide 2026 (Showroom / Connection Hub tiers) — Tactionsoft](https://www.tactionsoft.com/blog/epic-ehr-integration-guide/)
- [TransformativeMed solutions (CORES)](https://www.transformativemed.com/solutions)
- [eDocList — patient handoff list for residents and hospitalists](https://www.edoclist.com/)
- [TigerConnect Alarm Management in Epic Toolbox](https://tigerconnect.com/resources/newsroom/tigerconnect-alarm-management-now-available-epic-toolbox)
- [TigerConnect scheduling intelligence, June 2026 — Business Wire](https://www.businesswire.com/news/home/20260625254206/en/TigerConnect-Expands-AI-Powered-Clinical-Communication-Platform-with-New-Scheduling-Intelligence)
- [Abridge business breakdown — Contrary Research](https://research.contrary.com/company/abridge)
- [Abridge raises $300M — STAT News](https://www.statnews.com/2025/06/24/ai-clinical-documentation-ambient-scribe-abridge-raises-300-million/)
- [Ambient AI scribe comparison guide 2026 — MedEquip Directory](https://www.medequipdirectory.com/guides/ambient-ai-scribe-comparison-guide-2026-dax-abridge-nabla-deepscribe/)
- [Why investors keep backing AI scribes — Iatrox](https://www.iatrox.com/blog/healthcare-ai-scribe-funding-kin-abridge-suki)
- [Clinical Communication & Collaboration market — Grand View Research](https://www.grandviewresearch.com/industry-analysis/clinical-communication-collaboration-market)
- [Clinical Communication & Collaboration market forecast 2026–2032 — Research and Markets](https://www.researchandmarkets.com/reports/5336607/clinical-communication-and-collaboration-market-by)
- [SOC 2 Type II for healthcare startups — Opexia](https://opexia.io/insights/soc2-type2-healthcare-startup-guide)
- [HIPAA compliance for startups: when to start — Aptible](https://www.aptible.com/hipaa/when-to-start)
- [SOC 2 vs HIPAA for healthcare SaaS — Software Secured](https://www.softwaresecured.com/post/soc-2-vs-hipaa-comparison-for-healthcare-saas)
- [India's DPDP Act 2023 and draft Rules 2025: operational considerations for hospitals — JDRNTRUHS](https://www.ovid.com/jnls/jdrntruhs/fulltext/10.4103/jdrntruhs.jdrntruhs_107_25~indias-dpdp-act-2023-and-draft-dpdp-rules-2025-operational)
- [DPDP compliance now mandatory for healthcare — Security Boulevard](https://securityboulevard.com/2026/02/dpdp-compliance-is-now-mandatory-for-the-healthcare-industry/)
- [DPDP Act applicability in hospitals — Aarna Law](https://www.aarnalaw.com/insights/the-applicability-of-the-dpdp-act-in-hospitals-a-new-era-for-patient-data-protection)
- [Bahmni open-source EMR/HMIS](https://www.bahmni.org/)
- [50+ digital health apps integrated with ABDM — Medgate Today](https://medgatetoday.com/more-than-50-digital-health-services-applications-integrated-with-ayushman-bharat-digital-mission-abdm)
- [5 patterns behind healthcare startups that fail — KevinMD](https://kevinmd.com/2026/04/5-patterns-behind-health-care-startups-that-fail.html)
- [10 reasons why healthcare startups fail — STAT News](https://www.statnews.com/2020/02/10/10-reasons-why-health-care-startups-fail/)
- [Why most medical device startups fail — Informal](https://www.informal.cc/blog/why-most-medical-device-startups-fail-and-how-to-avoid-following-suit/)
