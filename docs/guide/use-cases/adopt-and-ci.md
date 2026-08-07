# Adopt the linter and wire it into CI

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** go from zero to a working config and a CI gate.

```bash
wastech-mdlint init                       # interactive: scans, infers a rule set, writes config
wastech-mdlint init --yes                 # CI-friendly: accept the inferred draft, no prompts
wastech-mdlint init --yes --with-ci-workflow   # also drop .github/workflows/wastech-mdlint.yml
```

Then gate CI on exit codes:

```bash
wastech-mdlint lint .                 # exit 1 on errors → fails the job
wastech-mdlint lint . --fail-on warning
```

Exit `1` means findings and nothing else, so a red job is a real documentation problem. A broken step — a typo'd subcommand, a `[path]` that does not exist in the checkout, a config the runner cannot read — exits `2` instead of quietly passing as "no problems found".

**You get:** a `wastech-mdlint.config.json` with a local `$schema` and rationale comments, plus a CI-ready lint step. The dropped workflow installs and runs the CLI via npm regardless of the project's package manager — it only fetches the external tool, never your repo's dependencies, so it needs no lockfile. A workflow that is already there is kept and reported as kept, never overwritten — so re-running `init` on an adopted repo is safe, but check that the existing one still points at the config you just wrote. The corpus `init` proposes excludes hidden and `.gitignore`d trees, so the CI scaffolding under `.github/` and any generated docs directory are not themselves linted — and the draft names what it skipped, with a count for the dot-directories, so adding `".agents/**/*.{md,mdx}"` to `include` is a decision rather than a discovery. `init` writes nothing on install — configuration is always explicit. See [`init`](../cli.md#init) and [Output → exit codes](../output.md#exit-codes).
