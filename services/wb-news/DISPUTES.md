# WB disputes synchronization

The existing WB browser worker reads hanging goods, defects, substitutions and both ticket interfaces for the registered organizations and points. It never sends WB tickets, replies or financial actions. Current registry: 12 organizations, 20 points; new points must be registered explicitly.

The database aligns automatic runs with the three-hour UTC wake slots at :17, with a persistent single-worker lease. Authentication and bot challenges stop collection and require the owner's intervention. Render free instances are woken by the GitHub Actions workflow; scheduler delays are possible. The wake job sends health requests for up to 110 minutes so an in-progress scan is not stopped by the free service’s 15-minute inbound-idle limit. The browser scan itself remains bounded to 100 minutes. The UI shows actual last success and incomplete scopes.

Session backup uses the existing server ingest credential and AES-GCM envelope; neither WB sessions nor ingest credentials are exposed to the public frontend. The owner can request a refresh through the authenticated Edge endpoint. Public server status omits financial reports.

Observations preserve separate ticket/card identities even for repeated barcodes. Where WB exposes no event identifier, identity is explicitly marked observed_card. Missing observations are archived only after a complete count-verified scope; manual cases are never replaced. Ticket histories retain previous messages. Only an appended support reply after baseline creates the needs_attention flag; this is an in-app flag, not an outbound notification.

Source files: disputes-browser.mjs (browser), disputes-model.mjs (normalization), disputes-supabase.mjs (private transport), disputes-ingest.ts (Edge function), disputes-schema.sql (additive schema and server-only RPC), apps/disputes/sync-ui.js (owner UI).

Database migrations were applied separately as edpvz_disputes_browser_sync edpvz_disputes_sync_due_time and edpvz_disputes_worker_privileges. Do not blindly rerun the complete schema file against an already migrated database. Deploy the Edge entrypoint with its own credential/JWT validation, then deploy the existing Render service. Its auto-deploy is disabled.

Validation: npm ci; node --test test/*.test.mjs. DOM extraction tests use synthetic markup; a successful authenticated full run remains necessary to confirm current WB layout and all registered scopes. Database transactional checks cover replay, duplicate barcodes, reply baseline and append, archival and cross-owner access.
