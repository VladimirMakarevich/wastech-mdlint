Produce the triage report as your structured output — you write no files.

Draw on the steps before you:{?analysis_path} the analysis at {analysis_path},{/analysis_path}{?reproduction_path} the reproduction attempt at {reproduction_path},{/reproduction_path}{?review_path} and the review findings at {review_path}.{/review_path} Carry nothing the review rejected.

Write the report for a maintainer, in this order: what the item asks for, what is actually true (with citations), and what should happen. Keep it short enough to read at a glance.

Then end the report with **exactly one** block in this form, fenced with the tag shown. A machine reads this block and nothing else; the prose above is for people.

```worc-connect-triage
verdict: actionable | needs-info | duplicate | declined
reason: >-
  One short paragraph. For `needs-info` this is the question the reporter is asked, so write it
  to them, name exactly what is missing, and ask nothing you could have found yourself. For
  `duplicate` and `declined` it is why, in words they can disagree with.
duplicate_of: null
acceptance_criteria:
  - Observable outcome a reviewer would check.
failing_test:
  path: null
  body: null
```

Rules for the block:

- `verdict` is one of the four words, and nothing else. Pick `actionable` only when the change is clear enough to be implemented from this report alone; `needs-info` when a fact only the reporter has is missing; `duplicate` when this repository already tracks or has fixed it (name what, in `duplicate_of`); `declined` when it is outside what this project does.
- `reason` is required for every verdict. What it says is published where the reporter reads it.
- `acceptance_criteria` is a list of observable outcomes, or omitted. Include it only for `actionable`, and only criteria the analysis actually supports.
- `failing_test` carries the reproduction as text — `body` the test itself, `path` where it belongs — or is omitted when there is none. Do not point at a file: nothing you wrote survives this run.
- The block is YAML. Quote or use a block scalar for anything containing a colon, and make sure the fences match, or the whole report will be read as carrying no verdict at all.

Return the whole report, block included, as the `content` field of the structured output. The orchestrator writes it into the private report directory for you.
