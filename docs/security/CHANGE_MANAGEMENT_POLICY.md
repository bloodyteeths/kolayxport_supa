# KolayXport Change Management Policy

Aligned with Amazon SP-API Data Protection Policy (Application Security / Change
Management) and the "Vulnerability Management" technical paper. Reviewed every 6 months.
Last reviewed: 2026-07-16.

## Scope
All changes to code, configuration, and infrastructure that handle Amazon Selling
Partner data.

## Roles & responsibilities
Founder-led small team. The founder is responsible for authoring, testing, verifying,
approving, and deploying changes. External contributors (if any) submit changes via
pull request for the founder's review before merge.

## Change workflow (every change follows this path)
1. **Develop** on a feature branch in Git — production (`main`) is never edited directly
   for feature work.
2. **Test locally** — unit tests (Vitest) and, where relevant, end-to-end tests
   (Playwright); a full production build (`next build`) must pass locally before push.
3. **Pull request / review** — changes land on `main` via commit/PR; CI (`.github/
   workflows/ci.yml`) runs the test suite, and the security scan (`security-scan.yml`,
   npm audit + Semgrep) plus Dependabot run automatically. A change is not deployed until
   these pass.
4. **Approve** — the founder reviews and approves the change (self-review + green CI/
   security gates for solo work; PR approval for external contributions).
5. **Deploy** — automated via `.github/workflows/deploy-hetzner.yml`. The build runs into
   a staging directory (`.next-new`) and is **atomically swapped** with the live `.next`
   only on success, so a failed build never touches production.
6. **Verify** — post-deploy health check (`/api/health`) and log review.

## Testing before production
Changes are validated by automated tests in CI and a mandatory local production build
before they can reach production. Production and non-production are separated (local dev
+ CI vs. the Hetzner production host, with separate KMS keys).

## Who may perform changes
Only the founder has write access to the `main` branch and SSH access to production
(individual SSH keys, no shared accounts). Deploy is gated on passing CI.

## Rollback
Roll back by reverting the offending commit and redeploying (the atomic `.next` swap
means the previous build stays live until a good build replaces it). Database changes are
recoverable from the encrypted off-site backups (see DATA_HANDLING_POLICY.md).

## Emergency changes
Urgent fixes follow the same pipeline (branch → test → deploy); if a hotfix must bypass
part of CI it is documented in the commit and re-validated immediately after.

## Vulnerability remediation (change-driven)
Findings from Dependabot / Semgrep / npm audit and any penetration test are triaged and
remediated through this same change pipeline, with SLAs: **critical within 7 days, high
within 30 days.**
