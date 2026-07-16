# KolayXport Security Awareness

Aligned with Amazon SP-API Data Protection Policy (Privacy — Security Awareness Training).
Reviewed annually. Last reviewed: 2026-07-16.

## Approach
KolayXport is a founder-led small team. Everyone with access to Amazon Selling Partner
data completes a security-awareness review at least **annually** and on onboarding,
covering:

- **Data protection:** what counts as Amazon seller/buyer PII, how it must be handled
  (encrypted at rest + in transit, minimum necessary, need-to-know), and the retention
  policy (see DATA_HANDLING_POLICY.md).
- **Credential hygiene:** never hardcode or share secrets; secrets live only in
  environment variables / the KMS; use strong unique passwords + MFA on all consoles.
- **Phishing & social engineering:** verify unexpected requests, never disclose
  credentials, treat links/attachments with suspicion.
- **Endpoint security:** full-disk encryption (FileVault), anti-malware, and OS patching
  on any device used to access production.
- **Incident reporting:** how to recognise and report a suspected incident, and the
  24-hour notification obligation to security@amazon.com (see INCIDENT_RESPONSE_PLAN.md).

## Secure development
The founder follows secure-coding practices reinforced by automated tooling in CI
(Dependabot, Semgrep, npm audit) and the change-management process
(CHANGE_MANAGEMENT_POLICY.md).

## Attestation record
| Date | Name / role | Completed |
|------|-------------|-----------|
| 2026-07-16 | Founder | ✅ annual review |

_(Add a row at each annual review and for every new person with data access.)_
