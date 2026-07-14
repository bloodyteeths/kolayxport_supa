# KolayXport Data Handling, Classification & Retention Policy

Aligned with Amazon SP-API "Data Retention and Recovery" and the Data Protection Policy.
Reviewed every 6 months. Last reviewed: 2026-07-14.

## Data classification
| Class | Examples | Controls |
|-------|----------|----------|
| **Secret** | Amazon LWA access/refresh tokens, API keys, encryption keys | AES-256-GCM at rest, DEK wrapped by OpenBao/Vault Transit KMS; env-vars only; never logged (redacted); constant-time compare |
| **Restricted (PII)** | Buyer name, shipping address, phone, email | Encrypted at rest; access limited to serving the authorizing seller; redacted in logs; retention-limited (below) |
| **Confidential** | Order, product, inventory, financial data | Encrypted at rest; localhost-only DB; access controlled |
| **Internal** | App config, non-sensitive logs | Standard access controls |

## Data lifecycle
- **Collection:** only via SP-API over HTTPS, only the roles the seller granted, only data needed to provide the service.
- **Storage:** PostgreSQL on the Hetzner VPS (localhost-only); secrets and PII encrypted at the application layer.
- **Access:** need-to-know; the authorizing seller's own data only; admin access via individual SSH keys.
- **Transfer:** buyer address transferred only to carriers to create the seller's shipping labels. No sale or sharing of Amazon data.
- **Disposal:** on account disconnect or deletion request, Amazon credentials and synced Amazon data are deleted; encryption keys can be revoked via the KMS.

## Retention
- **Amazon buyer PII (addresses/names):** retained only while needed to fulfil and support the order — target **≤ 90 days after shipment**, then purged by a scheduled job.
- **Order/financial metadata (non-PII):** retained for the seller's reporting needs.
- **Credentials/tokens:** retained while the integration is connected; deleted on disconnect.
- **Logs:** 12-month retention, secrets and PII redacted.

## Backup & recovery (RTO/RPO)
- **Backups:** encrypted PostgreSQL dumps stored in a geographically separate location from the production VPS.
- **RPO (max data loss):** ≤ 24 hours (daily encrypted backup).
- **RTO (max downtime to restore):** ≤ 4 hours (documented restore procedure: provision host, restore latest encrypted dump, re-point the app, unseal KMS).
- Backups are encrypted; restore is tested periodically.

## Subprocessors (third parties)
KolayXport does **not** sell or share Amazon data with third parties. Infrastructure subprocessors:
| Provider | Purpose | Amazon PII sent? |
|----------|---------|------------------|
| Hetzner (DE) | Hosting / compute / DB | Stored (encrypted); not accessed by provider |
| Postmark | Transactional email | No |
| Stripe | Non-Amazon SaaS billing | No |
| Google (Gemini) | AI listing/research tools | **No** — Amazon buyer PII is never sent |

## Data-subject rights
Sellers may request export or deletion of their data at any time via support; handled within the timeframes required by GDPR/KVKK.
