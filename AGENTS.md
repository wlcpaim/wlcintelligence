<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Architecture Notes

- **PRO prompt budgets.** Build keeps complete editable source within a shared character budget; planning expansion spends the remaining budget and only PICK receives the project map. Why: avoid duplicate context and unsafe truncated source.
- **PRO key scheduling.** Opt-in project-aware least-recently-used scheduling uses persisted key usage; other engines retain primary-first ordering. Why: distribute sequential PRO phases without changing specialist preferences or pretending provider quotas disappear.
- **Surgical matching.** Whitespace-tolerant edits map each normalized character to its exact source range and reject non-unique matches. Why: line-count heuristics can remove neighboring code.

- **User-owned integrations encryption.** Per-user Gemini, GitHub, and Cloudflare tokens are encrypted server-side with AES-256-GCM using `INTEGRATIONS_MASTER_KEY` and per-user AAD (`src/modules/integrations/core/crypto.server.ts`); never hardcode credentials in `quick-setup/credentials.server.ts`.
- **Legacy account claim.** Imported records map through server-only `public.legacy_users` and transfer to a signed-in account only via `public.claim_legacy_account()` after verified email ownership.
- **WLC 1.9.9 Bootstrap Level-0 enforcement.** `src/modules/v199/core/bootstrap.ts` validates the base runtime quartet (`package.json`, `tsconfig.json`, `index.html`, entrypoint) and declared dependencies after Phase 2 so `runner.server.ts` forces DevOps and passes full config files plus static build issues into Phase 4 (`runCodeAnalyst`), preventing uncompilable external projects from reaching Deploy.
- **Interrupted bot output.** Recover only fully closed JSON file objects, discard truncated files, and mark the result partial; never repair a source string by inventing its missing ending.
- **Team persistence.** Resolve the chat destination once and write consolidated files after all phases; create a chat project only when no destination exists, preventing parallel bots from scattering writes.
- **SPA deployment.** Require a Pages navigation fallback only for Vite SPAs, not server-rendered frameworks, to preserve server routes.
- **Chat project isolation.** A v1.9.9 chat reuses only the project linked in its own history (`projectFromHistory`), otherwise creates a new one; generated `package.json` is sanitized (`core/sanitize.ts`) before saving. Why: chats were overwriting each other and builds failed on fake versions.
- **Gap-healing.** After Phase 2 and after the Code Analyst, `runGapHealer` regenerates only missing locally-imported or interrupted-bot files, in small batches on the least-used Gemini key (`core/gaps.ts`); why: truncated bots left imports pointing at files that never existed and broke deploys.
- **Preflight healing.** Generation and publication reconcile only known missing dependencies; publishing checks credentials first, uses bounded surgical repair, backs up and conditionally saves corrections before committing, and blocks on remaining errors (not architecture warnings). Why: local integrity failures must reach recovery without overwriting concurrent edits or pretending a build succeeded.
- **Functional-gap gate.** `detectFunctionalGaps`, `detectDeadLinks` and `detectUnconsumedServices` flag hollow admin pages, links to undeclared routes, and services no screen imports as errors; the runner's Product Completion bot (`runProductCompletion`) creates the missing pages/routes right after Phase 2. Why: parallel Frontend/Backend shipped showcase-only apps whose buttons fell into the catch-all.
- **Team time budget.** Copilot 1.9.9 runs with a hard limit plus a soft deadline (`v199/core/budget.ts`); after the soft deadline, optional phases (gap-healer, QA/DevOps, Code Analyst, model repair) are skipped so specialist output still returns. Why: the full pipeline exceeded the request timeout and the user lost the whole generation.
