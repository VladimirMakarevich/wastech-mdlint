# P1–P3 · Журнал автономного прогона

> Автономная реализация фаз P1 → P2 → P3 дорожной карты v2. Единственная рабочая ветка
> `feat/mdlint-v2-p1-p3` (от `main`). Этот файл — обязательный артефакт: сюда пишется всё, что
> в обычном режиме потребовало бы «остановиться и спросить» (решения, допущения, противоречия,
> отложенные follow-up). Даты в формате ISO; сегодня — 2026-07-03.

## Принятые решения и допущения

- [P1.01] `ParsedDocument` получает дополнительное поле `path` (repo-relative POSIX), которого
  нет в минимальном списке P1.01 → добавлено как additive-поле → обоснование: findings в
  движке правил (P2) атрибутируются по repo-relative пути, а `loadDocuments` возвращает
  `Map<absPath, ParsedDocument>`; хранить относительный путь в самом документе избавляет
  потребителей от повторного вычисления и фиксирует его детерминированно в одной точке
  (loader). Поле дополняет контракт, ничего в нём не двигая (см. P1.01 «no field will move»).
- [P1] Новый парсер (`parseDocument`/`loadDocuments`) и типы `ParsedDocument` добавляются
  **рядом** со старым `parseMarkdownFiles` и легаси-пайплайном, не заменяя их. Обоснование:
  cutover `scan → lint` и удаление легаси происходят только в P3.09 (см. P3 exit criteria);
  до этого `scan` обязан работать, а гейт — оставаться зелёным.
- [P2.01] `LintMessage` использует `filePath` (не `path`) и `line: number` (обязательное), как в
  явном списке полей P2.01 — а не буквальный «strict superset» легаси `Finding` (там `path`,
  `line?`). Приоритет: явный список полей задачи > формулировка exit-критерия. Легаси `Finding`
  живёт параллельно до P3.09.
- [P2.01] Соглашение о `line`: `line: 0` — сентинел «нет конкретной строки» (file-/section-level:
  SIZE по всему файлу, отсутствующая секция SEC, отсутствующий файл STR, orphan GRP). Рендер
  печатает `-` вместо `line:col`. Такие findings **не** подавляются inline-директивами (директивы
  начинаются со строки ≥1); для них — `severity: "off"` в конфиге.
- [P2.01] В `RuleContext` добавлено поле `rootDir` (абсолютный cwd), которого нет в минимальном
  списке P2.01 → нужно REF-001/REF-003 для `existsSync` (резолвинг ссылок/картинок на диске вне
  Markdown-корпуса, audit P3 REF gap). `documents` в `RuleContext` ключуются **repo-relative**
  путём (в отличие от `loadDocuments`, где ключ — абсолютный POSIX-путь); оркестратор
  перектючёвывает карту.
- [P2.01→P2.05] `ResolvedRule.severity` заменён на `severityOverride?`, а `ReportInput` получил
  `severity?`. Обоснование: SIZE-001 эмитит severity **на finding** (warn/error по порогу), а
  C2-override должен клампить. Итоговая severity = `override ?? finding.severity ?? defaultSeverity`.
- [P2.04] Zero-config default (нет `wastech-mdlint.config.json`) → `{ include:["**/*.md"], rules:[] }`
  (чистый проход, 0 findings). Осмысленный zero-config набор правил — задача P6 `init` (C6 presets
  отложены). Обоснование: не гадать дефолтный ruleset до P6.
- [P2.04] Новый конфиг переиспользует класс `ConfigError` из легаси `config/load.ts` (один тип
  ошибки, стабильный barrel; CLI ловит его и для scan, и для lint). Перенос в новый модуль — на
  cutover P3.09.
- [P2.04] Новые публичные имена, чтобы не конфликтовать с легаси barrel: `loadConfiguration`
  (vs легаси `loadConfig`), `estimateTokensV2` (vs легаси `estimateTokens`). Переименование в
  чистые имена — на P3.09 после удаления легаси.
- [P2.06] Верхнеуровневый `$schema` в `schema.json` = идентификатор диалекта JSON Schema
  (`https://json-schema.org/draft/2020-12/schema`, как отдаёт `z.toJSONSchema`). Это **не** тот
  удалённый URL, что запрещает C9: C9 про ссылку конфиг→schema (она остаётся локальным
  относительным путём). Диалект резолвится валидаторами офлайн.
- [P2.07] `lint` добавлен как **именованная** команда (не default), `scan`/`graph` работают как
  раньше. Обоснование: сделать `lint` дефолтом и `scan` скрытым алиасом — по D4 в конце P3
  (P3.09), чтобы не ломать существующие scan-тесты сейчас.
- [P2.07] REF-001 и SIZE-001 реализованы сразу как **финальные** правила (не выбрасываемые
  заглушки); P3.04/P3.07 добавляют остальные REF/LLM-правила и оставляют эти как есть.
- [P3.02/P3.03] `--fix` реализован только для **document-scope** правил (TextEdit адресует контент
  одного документа; project-правила не дают fix). Locked fixable subset (audit 4.2) = TBL-002
  (empty→TODO) + SEC-001 (scaffold отсутствующих секций в конце файла). «SEC-* scaffold» реализован
  на SEC-001; SEC-002 (reorder) и SEC-003 (project template) — `fixable:false` (небезопасно/не
  document-scope), их fix — follow-up P4+.
- [P3.04 REF-004] Underspecified: «cross-zone links declared in zone Dependencies». Принятая модель:
  zone = первый сегмент под `zonesDir`; ссылка из зоны A в зону B «объявлена», если имя зоны B как
  слово встречается в теле секции `dependencySection` (default "Dependencies") любого файла зоны A.
  Обоснование: даёт рабочее детерминированное правило; scope=document, но читает корпус для знания
  зон/деклараций.
- [P3.04 REF-005] Column-based (audit 5.5) через общий `extractColumnIds`/`extractDefinedIds`
  (audit 2.1, экспортирован для id-ref рёбер P4). Модель: `definitions`/`references` — file-globs,
  `idColumn` — колонка ID (одна и та же в def- и ref-таблицах), `idPattern` валидирует токен;
  ячейка может содержать несколько ID (split по `[,\s]`). Dangling ref → error, orphan def →
  warning (per-finding severity). Оба поля обязательны (min 1).
- [P3.04 REF-006] Underspecified stability-модель: `id→stability` из def-таблиц (idColumn+
  stabilityColumn); ref-строка несёт referenced ID (idColumn) и стабильность **ссылающегося**
  (stabilityColumn); `stabilityOrder` — от наименее к наиболее стабильному (rank=index). Warning,
  если ранг(referenced) < ранг(referencer).
- [P3.06] P3-граф — **link-only** (relocated legacy builder, audit 2.2): рёбра только из
  markdown-ссылок на `.md` (type "link"), dedup по (from,to), циклы через Tarjan SCC (G6). GRP-001
  читает `graph.cycles`, GRP-002 — `inDegree`. P4.06 подменяет билдер на семантический
  (anchor/import/id-ref рёбра) без изменения read-shape. GRP-001 files?/exclude?/siteRouter? не
  ре-скоупят общий корпус-граф в P3 (общий граф уже сконфигурен include/exclude).
- [P3.09] `graph`-команда мигрирована на v2-конфиг (`loadConfiguration`) + `loadDocuments` +
  `buildContextGraph` (выводит ContextGraph JSON). Причина: удаление легаси-конфига в рамках
  cutover форсировало это. Богатый graph/slice/impact CLI — P4.07.
- [P3.09] README переписан под v2 (удалены описания легаси: `.cjs/.mjs`-конфиг, sectioned config,
  `links/broken-links`, "Markdown Context Audit"-вывод). Таблица правил генерируется из метаданных
  (`npm run generate:docs`), синхронность проверяется тестом. Полный маркетинговый polish — P9.
- [P3.09] Скрипт `generate:schema` → `generate:docs` (генерирует schema.json + README-таблицу).
  Финальные имена после удаления легаси: `estimateTokens` (без V2-суффикса), `loadConfiguration`
  оставлено как есть (не переименовано в loadConfig — минимизация churn, имя ясное), `ConfigError`
  перенесён в `config/config-error.ts`.

## Coexistence / cutover план (scan → lint), фиксируется для P3.09

- До P3.09: сосуществуют легаси-пайплайн (`scan`, `graph`, `checkLocalLinks`/`checkFileSizes`/
  `checkStructureRules`/`analyzeLlmImports`/`buildEntrypointBudgets`/`createAuditResult`/
  `renderAuditResult*`, легаси `config/{load,defaults}.ts`, `AuditConfig`, `Finding`,
  `parseMarkdownFiles`) и новый движок (`lint`, `schema`, `lintFiles`, `loadConfiguration`).
- На P3.09 (D4/D2): `lint` становится default-командой; `scan` — скрытый алиас `lint`; легаси
  lint-пайплайн и sectioned-config удаляются; `estimateTokensV2`→`estimateTokens`,
  `loadConfiguration`→`loadConfig` (по возможности), `ConfigError` переносится в новый модуль.
  `graph` остаётся до P4 (переезжает на `ContextGraph`).

## Противоречия в документации

- [P3.03 SEC-003 `level`]: `04→P3.03` говорит одновременно «up to depth level» (depth ≤ level) и
  «level: 2 checks only ## headings» (depth == level). Конфликт. Разрешено по приоритету §4 в
  пользу **конкретного примера** (ADR): `level` = **точная** глубina сравнения (`depth === level`),
  т.к. иначе per-doc `# Title` шаблона требовался бы во всех файлах (ложные срабатывания). Default
  (без `level`) — все глубины.
- [P3 rule count / категории]: `P2/P3 index.md` в тексте фаз упоминает «CHK (001)» и «CTX (001–002)»,
  но авторитетные файлы задач (P3.05) определяют checklist как **CTX-002**, а категории — TBL(6)/
  SEC(3)/STR(1)/REF(6)/CTX(3)/GRP(3) = **22** built-in. Отдельной категории CHK нет. Разрешено по
  §4 в пользу файлов задач (drift в index — устаревший).

## Отложенные follow-up (P4+ / вне scope)

- [P4.06] Семантические рёбра графа (anchor/import/id-ref по таксономии audit 2.5) — заменить
  P3 link-only `buildContextGraph`; GRP-001/002 не меняются (read-shape стабилен). Общий
  `extractDefinedIds` уже готов и экспортирован для id-ref рёбер.
- [P4.07] Богатый `graph`/`slice`/`impact` CLI (сейчас `graph` выводит ContextGraph JSON как
  временную замену), `--format mermaid|dot` (G9), query-слой (G2), coverage-сигнал (G5).
- [P4] GRP-001 files?/exclude?/siteRouter? — ре-скоуп общего графа per-rule (сейчас не влияют).
- [P3/P8] Fix для SEC-002 (reorder) и SEC-003 (project template scaffold) — сейчас `fixable:false`
  (небезопасно/не document-scope). --fix движок пока только document-scope.
- [P5] `describeRules` из метаданных (источник готов — `ruleRegistry.getAllMetadata()`),
  compile-секция конфига (сейчас `compile` в схеме — `type:object`, не валидируется).
- [P6] `init` пишет реальный zero-config ruleset (сейчас no-config default = пустые rules);
  project-local schema через `generateConfigSchema({customRules})` (API готов, audit 4.1).
- [P7] MCP-инструменты поверх `lintFiles`/`buildContextGraph`; error-taxonomy (audit).
- [tokens] Замена эвристики `estimateTokens = ceil(len/4)` на реальный токенайзер (изолирована в
  `engine/tokens.ts`).
- [REF-004/005/006] Ниши недоспецифицированы; пересмотреть модель, если спецификации уточнятся
  (см. «Принятые решения» выше).
