# Enforce a requirements-table schema

> [Guide](../README.md) · [Use cases](README.md) · [Rules](../rules/README.md)

**Goal:** every requirements table must have `ID`, `Owner`, `Status`; IDs look like `REQ-123` and
are unique across files; `Status` is from a fixed set; a `done` row must have an `Owner`.

```jsonc
{
  "include": ["docs/requirements/**/*.md"],
  "rules": [
    { "rule": "TBL-001", "options": { "requiredColumns": ["ID", "Owner", "Status"] } },
    { "rule": "TBL-002", "options": { "columns": ["ID", "Status"] } },
    { "rule": "TBL-004", "options": { "column": "ID", "pattern": "^REQ-\\d+$" } },
    { "rule": "TBL-003", "options": { "column": "Status", "values": ["todo", "doing", "done"] } },
    { "rule": "TBL-006", "options": { "column": "ID" } },
    { "rule": "TBL-005", "options": {
      "when": { "column": "Status", "equals": "done" },
      "then": { "column": "Owner", "notEmpty": true }
    } }
  ]
}
```

```bash
wastech-mdlint lint docs/requirements
wastech-mdlint lint docs/requirements --fix   # TBL-002 fills empty ID/Status cells with ` TODO `
```

**You get:** a report of tables missing columns, malformed IDs, duplicate IDs across files,
out-of-set statuses, and `done`-without-owner rows. See
[TBL-001](../rules/TBL-001.md)…[TBL-006](../rules/TBL-006.md).
