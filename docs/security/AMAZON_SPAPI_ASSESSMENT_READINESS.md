# Amazon SP-API Data Security Assessment — Readiness Pack

Prep for the Amazon-run Data Security Assessment (free, ~8h over a month; stages:
Submit questionnaire → Assessment call → Remediation). Maps each of the 12 assessment
domains to KolayXport's actual controls, the evidence to show, and remaining gaps.

Use this to (a) fill the self-assessment Qualtrics, (b) answer the formal questionnaire,
and (c) speak to controls on the assessment call. Legend: ✅ in place · ⚠️ partial /
documenting · 🔴 gap to close before/at remediation.

---

## System & data-flow overview (Domains 1, 10)

**What KolayXport is:** a multi-marketplace order-management + shipping SaaS. For Amazon,
it syncs orders, products, inventory, and finance data into a unified seller dashboard and
generates shipping labels (address features pending the restricted role).

**Architecture (single-tenant flow):**
```
Seller ─OAuth─> KolayXport (kolayxport.com, nginx TLS)
                     │
   Amazon SP-API ────┤  Next.js app (Hetzner VPS 46.224.169.225, systemd)
   (sellingpartnerapi-*.amazon.com, HTTPS)
                     │
                     ├─> PostgreSQL (localhost only) — Amazon tokens + order/PII fields
                     │     encrypted AES-256-GCM (DEK wrapped by OpenBao/Vault Transit KMS)
                     │
                     └─> SyncLog (secrets + PII auto-redacted)
```

**Amazon data lifecycle:**
- **Collection:** SP-API over HTTPS (Orders/Reports/Catalog/Feeds), authorized by the
  seller via LWA OAuth. Only the roles the seller granted.
- **Storage:** PostgreSQL on the Hetzner VPS; credentials/tokens and PII fields encrypted
  at the app layer (AES-256-GCM + Vault-wrapped DEK). DB bound to localhost.
- **Access:** used only to render the seller's own dashboard and generate their labels.
- **Transfer:** to carriers (FedEx/UPS/etc.) only to create the seller's shipping labels.
- **Disposal:** on disconnect/deletion, credentials + synced data are removed (retention
  policy below).

---

## Domain-by-domain evidence

**1. Business & system overview** ✅ — see above. Deliverable: the data-flow diagram.

**2. Security governance** ⚠️ — Policies: this pack + `INCIDENT_RESPONSE_PLAN.md`,
`DATA_HANDLING_POLICY.md`, `CHANGE_MANAGEMENT_POLICY.md`. Privacy: `/privacy` + KVKK/GDPR.
Third-party risk: subprocessors are Hetzner (hosting, Germany), Postmark (transactional
email), Stripe (non-Amazon billing), Google (Gemini AI — no Amazon PII sent). Gap: formal
subprocessor register (in the data-handling doc).

**3. Infrastructure security** ✅ — Data storage on Hetzner Postgres; app-layer AES-256-GCM.
Asset inventory: one VPS + one Postgres + OpenBao container. Baseline: hardened Ubuntu
24.04, default-deny UFW, SSH key-only, automatic security updates. Anti-malware: ClamAV +
freshclam + daily scans. Asset destruction: DB row deletion + KMS key revocation.

**4. Data protection** ✅/⚠️ — At rest: AES-256-GCM, DEK wrapped by OpenBao Transit KMS
(generation/rotation-90d/revocation, prod≠non-prod keys). In transit: TLS everywhere.
Classification: see data-handling doc (Amazon tokens = secret; buyer PII = restricted).
API key security: env-vars only, gitignored, KMS-wrapped, constant-time compare.
Retention/back-up: see gap below. 🔴 Dark-web credential monitoring — not in place (note as
remediation item).

**5. Network security & vulnerability management** ✅/⚠️ — UFW default-deny, fail2ban,
DB localhost-only (segregation). Vulnerability management: Dependabot + CodeQL enabled in
CI (see `.github/`). Remediation SLA: critical 7d / high 30d (change-mgmt doc). 🔴 External
network vuln scan / pen test — offered by Amazon's process; not independently commissioned.

**6. Application security** ✅/⚠️ — SDLC: Git + pull requests + CI (`ci.yml`, Vitest/
Playwright) + mandatory local `next build` before deploy. Code scanning: CodeQL on each
push. Change management: `CHANGE_MANAGEMENT_POLICY.md`. Atomic deploy (`.next` swap).

**7. Identity & access management** ✅ — Named individual access via individual SSH keys;
no shared logins. Privileged access: root over SSH key only, password auth disabled.
Remote access: SSH keys + UFW. Password management: 12-char min + upper/lower/digit/special,
no identity info, common-password blocklist, bcrypt cost 12; cloud consoles use MFA.

**8. Security monitoring & incident response** ✅/⚠️ — Log management: structured SyncLog,
secrets + buyer PII auto-redacted, categorized (security/auth/integration/billing), 12-month
retention. Health checks every 15 min. Incident plan: `INCIDENT_RESPONSE_PLAN.md`
(roles, 24h notify to security@amazon.com, 6-month review).

**9. Privacy** ⚠️ — Privacy regulation: KVKK (Turkey) + GDPR-aligned; `/privacy`. Data
movement: documented above. Data-subject rights: account deletion + data export on request.
🔴 Security awareness training — as a small team, document annual self-training/attestation.

**10. Data handling & management** ✅ — lifecycle above; details in data-handling doc.

**11. Third-party integration** ✅ — **KolayXport does not sell, share, or transfer Amazon
data to third parties.** Amazon data is used solely to serve the authorizing seller.
Subprocessors (hosting/email/billing) are infrastructure providers, not data recipients;
Amazon buyer PII is never sent to the AI provider. (Favorable domain — emphasize this.)

**12. Customer support** ⚠️ — Support via email; internal admin monitoring cockpit. Document
the support process + that support staff (the founder) access data on a need-to-know basis.

---

## Gap remediation plan (what to close before/at remediation)

| Gap | Action | Effort | Owner |
|-----|--------|--------|-------|
| Incident Response Plan doc | write `INCIDENT_RESPONSE_PLAN.md` | done in this batch | me |
| Data handling & classification + subprocessor register | write `DATA_HANDLING_POLICY.md` | this batch | me |
| Change management policy | write `CHANGE_MANAGEMENT_POLICY.md` | this batch | me |
| Code vulnerability scanning | enable Dependabot + CodeQL | this batch | me |
| Data retention + PII auto-purge | policy + scheduled purge job | small | me |
| Off-site, geo-separated encrypted DB backup + RTO/RPO | set up encrypted `pg_dump` to separate location | medium | me + you (storage) |
| Dark-web credential monitoring | add a monitoring service or document compensating controls | small | you |
| Security awareness training | annual self-attestation record | tiny | you |
| External network/pen test | Amazon's assessment covers the review; commission if they require | — | you |

Most items are free and I can implement/write them. The only external-cost item is an
independent pen test, and Amazon's own assessment process may satisfy the review.
