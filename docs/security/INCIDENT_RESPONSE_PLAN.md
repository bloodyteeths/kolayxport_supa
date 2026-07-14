# KolayXport Incident Response Plan

Aligned with Amazon SP-API "Protect Amazon SP-API Applications with Incident Response"
and Data Protection Policy §incident-notification. Reviewed every 6 months.

- **Owner / IMPOC (Incident Management Point of Contact):** KolayXport founder — <security@kolayxport.com>
- **Last reviewed:** 2026-07-14 · **Next review due:** 2026-01-14
- **Scope:** any security event affecting Amazon Selling Partner data (tokens, orders, buyer PII) or the systems that process it.

## Roles
Small team — the founder holds all roles and engages external help as needed:
- **Incident Lead / IMPOC:** coordinates response, owns Amazon + affected-party notification.
- **Technical Responder:** performs containment, eradication, recovery on the VPS/DB/KMS.
- **Communications:** handles seller and regulator notifications.

## Severity levels
- **SEV1 — Confirmed breach / PII exposure / unauthorized data access.** Immediate response; Amazon notified ≤24h.
- **SEV2 — Suspected compromise, no confirmed data loss** (e.g. anomalous access, leaked credential).
- **SEV3 — Policy/control failure, no data impact** (e.g. misconfig found internally).

## Response steps
1. **Detect & triage** — sources: SyncLog security/auth events, fail2ban, health-check alerts, cloud/provider alerts, external report to security@kolayxport.com. Assign severity, start an incident record (timestamped log).
2. **Contain** — revoke affected credentials and sessions; rotate the OpenBao/Vault Transit key and re-wrap the DEK; disable affected LWA tokens; block offending IPs (UFW/fail2ban); isolate affected components.
3. **Assess scope** — identify what Amazon data was accessed, which sellers/buyers are affected, and the time window, using SyncLog queries by user/operation/time.
4. **Notify** — **report security incidents involving Amazon Information to security@amazon.com within 24 hours of detection.** Notify affected sellers, and any regulator/data-subjects as required by GDPR/KVKK.
5. **Eradicate & recover** — remove the root cause, patch, restore from clean backups (see Data Handling & Recovery), verify integrity, and confirm services are healthy.
6. **Post-incident review** — within 5 business days: root-cause analysis, timeline, and corrective actions; update controls and this plan.

## Amazon notification content
Incident summary, detection time, Amazon data affected, sellers impacted, containment actions, and remediation plan. Send to security@amazon.com within 24 hours; keep the SP-API case updated.

## Testing
This plan is walked through (tabletop) at each 6-month review; credential-rotation and backup-restore steps are exercised as part of routine ops.
