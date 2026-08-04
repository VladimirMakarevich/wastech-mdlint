Investigate the **supply chain** of the project at `{repo}`: the dependencies it installs, the integrity of how they are pinned and verified, the code that runs at install and publish time, the CI workflows that build and release it, and what the published packages actually contain.{?scope_path} Stay inside the scope fixed at {scope_path}.{/scope_path}

This is the **last of four** analysis passes over disjoint attack surfaces: untrusted input → filesystem and configuration → interfaces → supply chain (yours). The code-level walk of the other three is already done — do not repeat it.{?analysis_untrusted_input_path} Input pass: {analysis_untrusted_input_path}.{/analysis_untrusted_input_path}{?analysis_filesystem_config_path} Filesystem/config pass: {analysis_filesystem_config_path}.{/analysis_filesystem_config_path}{?analysis_interfaces_path} Interfaces pass: {analysis_interfaces_path}.{/analysis_interfaces_path}

## You are handed scan evidence — read it before you start

{?npm_audit_path}The npm-native scan ran and its structured result is at {npm_audit_path}. It carries: one entry per advisory from `npm audit --json` with severity and fix availability, the `npm audit signatures` provenance result for the installed tree, lockfile presence and `lockfileVersion`, this repository's own lifecycle scripts, and every GitHub Actions `uses:` reference that is not pinned to a full commit SHA.{/npm_audit_path}{?checks_path} The core dependency scanner's report is at {checks_path}. Read it, and **check whether any scanner actually launched**: that checker runs a fixed set (`pip-audit`, `osv-scanner`) and a scanner that is not installed contributes no findings *and does not fail*, so an empty report there means "not scanned", never "clean". If nothing launched, say so as a finding about the audit's own coverage.{/checks_path}

Your job is not to restate that evidence. It is to turn it into **judgement**:

- **Reachability per advisory.** For each advisory, establish whether this product actually calls the vulnerable code path. Name the import chain — which of this repository's files reaches the vulnerable package, through which intermediate dependency, and in which command. An advisory in a dependency of a dev-only tool that never touches user input is a different severity from one in the parse path. Say which each is, and do not treat an advisory as a finding on its own merit.
- **Runtime versus development.** Separate dependencies that ship to a user of the published packages from those that only run in this repository's own CI and local development. A vulnerability that cannot reach an installed user is real for the maintainers and largely theoretical for consumers — report both, ranked differently, and say which population each affects.
- **Fix cost.** Where a fix is available, state whether it is a patch bump, a transitive resolution, or a breaking major upgrade, because that decides whether the finding is actionable today.

## What to look for beyond the scan

- **Install-time execution.** Lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`, `prepack`, `prepublishOnly`) run automatically. Audit this repository's own hooks for what they execute, and establish whether CI installs with scripts enabled — a dependency's install script runs with the privileges of whoever ran the install, which in CI is a token-bearing runner.
- **CI as the highest-value target.** Read every workflow under `.github/workflows/`. The questions that matter: which triggers run on code from an untrusted fork (`pull_request_target`, a `workflow_run` chained off a fork build, an issue-comment trigger); whether any such job checks out fork code *and* has access to secrets or a write-scoped token; what the `permissions:` block grants, and whether it is set at all (an absent block inherits a broad default); whether secrets are exposed to steps that run third-party code; and whether an unpinned action tag can be repointed at new code by its owner. Pair each of these with the concrete workflow file and line.
- **Publishing integrity.** How does a release happen, and who can trigger it? Look for the publish workflow, whether it uses a long-lived token or short-lived OIDC/trusted publishing, whether provenance attestation is generated, and whether a tag push by anyone with write access is enough to publish.
- **What ships.** Compare each package's `files`/`exports`/`bin` fields against what is actually built. Look for a published tarball that includes something it should not — a test fixture, a source map pointing at absolute local paths, a config with local details, an internal document. Anything that ships is public.
- **Lockfile integrity.** Confirm the lockfile is present and committed, that CI installs from it (`npm ci`, not `npm install`), and that resolved entries carry integrity hashes. Note any dependency resolved from something other than the public registry.
- **Delivery evidence.** Where the history is reachable **with the tools you were actually granted** (`git log` / `git show` need a shell), look for a dependency bumped without its lockfile, a lockfile edited by hand, a pin that was loosened, or a workflow permission that was widened. With no shell, say so and drop the claim.

## Coverage is measured, not assumed

A gate downstream re-derives this remit's file list from the repository and compares it against your report, so:

1. **Enumerate first.** `Glob` the manifests (`package.json` and `packages/*/package.json`), the lockfile, and `.github/workflows/**` before reading them, and keep that list — it is your denominator.
2. **Open what you enumerated.** A file you never opened supports no finding — and it supports no "no findings" either.
3. **One traced property per area.** Dependencies: one advisory traced to a real import chain or explicitly shown to be unreachable. CI: one workflow's trigger and `permissions` followed to what a fork could actually cause. Publishing: the path from a tag to a published artifact. A bare "walked, no findings" label is an unfinished pass.

Record an exact `path:line` (or `package@version` plus advisory id) for every observation you intend to make a claim about.

**Every finding is a pattern, not an instance.** An unpinned action, a missing `permissions` block, or an `npm install` in CI is almost never in only one workflow — grep the class and record every site.

Use the granted network access **only** to resolve an upstream advisory or CVE detail for a flagged dependency — the affected range, the fixed version, whether the vulnerable function is the one used. Do not fetch anything about this local repository, and do not use it to browse for general security advice. If network is unavailable, say so and fall back to the advisory text you were handed.

## Severity discipline

Rate by reachability and by blast radius, and mark **exploitable** (name the concrete trigger and who controls it) versus **theoretical** explicitly. A CI misconfiguration reachable by any fork PR outranks a high-severity advisory in an unreachable dev dependency, and your severities should say so.

{?review_path}

## Gaps to close on this pass

A coverage gate reviewed an earlier analysis round; its findings are at {review_path}. Close every gap it names that falls inside this remit — those files and properties first — and do not re-derive what the earlier round already covered.{/review_path}

Read only; do not edit code or write files. **Your report is your final message** — it is persisted as this node's output and is all that later nodes and the coverage gate receive, so it must carry the whole analysis plus a closing `## Coverage` section: what you enumerated, what you opened, what you deliberately skipped and why, and the traced property per area.
