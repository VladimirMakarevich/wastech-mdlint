# P1–P3 · Журнал автономного прогона

> Автономная реализация фаз P1 → P2 → P3 дорожной карты v2. Единственная рабочая ветка
> `feat/mdlint-v2-p1-p3` (от `main`). Этот файл — обязательный артефакт: сюда пишется всё, что
> в обычном режиме потребовало бы «остановиться и спросить» (решения, допущения, противоречия,
> отложенные follow-up). Даты в формате ISO; сегодня — 2026-07-03.

## Принятые решения и допущения

- [setup] Гейт проверки (§5 задания) прогоняется через `rtk` (проект настроен на RTK). Все
  git/npm-команды идут с префиксом `rtk` согласно `RTK.md`.
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

- (пока нет)

## Отложенные follow-up (P4+ / вне scope)

- (пока нет)
