# Аудит готовности P5–P9 — план vs фактическая кодовая база (P0–P4)

> Дата: 2026-07-05 · Ревьюер: Claude (Opus 4.8) · Ветка: `fix/p4-findings-remediation`
> Область: **фазы P5–P9** (compile / init / MCP / skills / release) + связанные с ними
> сквозные документы (`docs/mdlint_v2/index.md`, `requirements/01-configuration.md`).
> Тип аудита: **план vs реальность** — проверка документации задач P5–P9 против **смерженного**
> кода P0–P4. Продуктовый код **не менялся**; менялись только документы задач.

---

## 1. Итоговый вердикт

**P0–P4 реализованы и смержены** (PR #10 закрыл ветку remediation: findings **B** — coverage в
`graph --format json`, и **C** — `excluded` в JSON `impact` — устранены; F35 — разделитель ключа
ребра — тоже). Рабочее дерево чистое. Контрактная поверхность (единый barrel
`@wastech-mdlint/core`, конфиг, CLI, stub MCP, реестр правил) — прочная и детерминированная.

**Документы P5–P9 были направленно верны, но систематически отставали от кода.** Планы писались
против более ранней ментальной модели: они (а) ссылались на переименованные/несуществующие
экспортные символы, (б) описывали структуры вывода полями, которых нет в реальных типах, (в)
трактовали уже сделанную работу (метаданные пакетов, CI, v2-README, `release:check`) как
несделанную, и (г) наследовали устаревшую таксономию правил. Ни один дефект не блокирует продукт —
но реализатор, следуя докам буквально, быстро упёрся бы в ошибки компиляции или переделал бы уже
готовое.

Проверочные гейты (на момент аудита, для контекста — не менялись этим аудитом):

| Гейт | Результат |
| --- | --- |
| `git status` | ✅ чисто, P4-remediation смержен (PR #10) |
| Смердженные фазы | ✅ P0, P1, P2, P3, P4 |
| Не начаты | ⏳ P5, P6, P7, P8, P9 |

Сводка находок (все — точность документации, не дефекты кода):

| Фаза | Blocking | High | Medium | Low/Info | Всего |
| --- | --- | --- | --- | --- | --- |
| P5 compile | 2 | 1 | 3 | 5 | 11 |
| P6 init | — | 1 | 3 | 2 | 6 |
| P7 mcp | — | 3 | 2 | 6 | 11 |
| P8 skills | 1 | — | 1 | 6 | 8 |
| P9 release | 1 | 1 | 4 | 3 | 9 |
| Roadmap / requirements (сквозное) | — | 1 | — | — | 1 |

Один **межфазный конфликт** (frontmatter-схема SKILL.md, §4) — важнейшая находка, потому что
затрагивает и P5, и P8, и порядок фаз.

**Все находки уровня Blocking/High/Medium отражены правками в документах** (см. §8). Часть Low/Info
оставлена как есть с пометкой в аудите либо превращена в code-follow-up для этапа реализации (§7).

---

## 2. Методология

1. Зафиксирована **ground truth**: единый barrel [packages/core/src/index.ts](packages/core/src/index.ts),
   [config-schema.ts](packages/core/src/config/config-schema.ts),
   [registry.ts](packages/core/src/engine/registry.ts),
   [rules/index.ts](packages/core/src/engine/rules/index.ts), CLI
   ([program.ts](packages/cli/src/program.ts) + [commands.ts](packages/cli/src/commands.ts)),
   stub MCP ([mcp-server/src/index.ts](packages/mcp-server/src/index.ts)), метаданные всех
   `package.json`, `.github/workflows/`, а также журналы
   [p1-p3-execution-notes.md](docs/mdlint_v2/p1-p3-execution-notes.md) и [P4-AUDIT.md](P4-AUDIT.md).
2. Пять параллельных read-only агентов (по одному на фазу) сверили каждый task-файл фазы против
   реального кода и локированных требований; каждое утверждение **проверялось эмпирически** (grep
   символа/поля, чтение исходника) до попадания в находки.
3. Синтез, разрешение межфазного конфликта и правки документов — вручную, с перепроверкой каждой
   строки правки против исходника.

---

## 3. Ground truth — контракт, на который опираются P5–P9

Кратко фиксируем «как есть на 2026-07-05», потому что бо́льшая часть дрейфа P5–P9 — это расхождение
именно с этим списком.

- **Монорепо, 3 пакета:** `@wastech-mdlint/core` (единственный владелец пайплайна),
  `@wastech-mdlint/cli`, `@wastech-mdlint/mcp-server`. Легаси `src/` удалён на cutover P3.09.
- **Публичный API = единый barrel** `packages/core/src/index.ts`. Хосты импортируют **только** из
  `@wastech-mdlint/core`.
- **Реестр правил:** **24** встроенных правила в **8** категориях — TBL×6, REF×6, CTX×3, SEC×3,
  GRP×3, SIZE×1, STR×1, LLM×1 (+ `custom`). Категории `CHK` **нет** (чек-листы — это `CTX-002`).
  `ruleRegistry.getAllMetadata()` возвращает отсортированный `RuleMetadata[]`; комментарий реестра
  прямо говорит, что он «drives describeRules (P5) and init categories (P6)».
- **`generateRuleDocs` уже существует** и экспортируется (таблица правил в README, sync-тест
  `docs-sync.test.ts`) — P5 `describeRules` должен переиспользовать этот источник метаданных.
- **Конфиг:** `lintConfigSchema` — `.strict()`; ключи `$schema? / include? / exclude? /
  respectGitignore? / settings?{siteRouter?,idRef?} / rules? / compile?`. **`compile` —
  `z.unknown().optional()`** с комментарием «its shape is validated in P5»: форму compile-секции
  определяет и валидирует именно P5.
- **CLI-команды:** `lint` (default), `scan` (скрытый deprecated-алиас), `schema`, `graph`, `slice`,
  `impact`. Команд **`compile` и `init` пока нет**. Коды выхода: 0 pass / 1 findings-at-threshold /
  2 usage+operational.
- **MCP:** только stub — `createServer()`/`startServer()`, stdio-only, читает свою версию,
  entrypoint-guard, **ноль инструментов**. Инварианты (stdio-only, никакого кода-плагинов) уже
  зашиты. Шесть read-only инструментов — работа P7. SDK `@modelcontextprotocol/sdk@^1.29.0`:
  `registerTool(...)` (не deprecated `tool()`) несёт `outputSchema` + `annotations`.
- **Метаданные релиза уже частично готовы:** во всех трёх `package.json` есть
  `publishConfig{access:"public",provenance:true}`, `engines.node">=24.17.0"` (без верхней границы),
  `bin` (`wastech-mdlint`, `wastech-mdlint-mcp`), `files`. `exports` есть **только у core**;
  `cli`/`mcp-server` — bin-only. Внутренние зависимости пиннятся **литералом `"0.0.0"`** (npm
  workspaces), **не** `workspace:*`. Есть `.github/workflows/{ci,publish}.yml`, root-скрипт
  `release:check` и `generate:docs`. README **уже переписан под v2** на P3.09.
- **Токен-оценка:** `estimateTokens` = `ceil(len/4)`, изолирована в `engine/tokens.ts` (D3).
- **`relativizeImpact`** экспортируется, но **потребителя пока нет** — он ждёт P7.

Отложенные follow-up, обещанные именно этим фазам (из журналов): P5 — `describeRules` +
compile-секция конфига; P6 — реальный ruleset (сейчас no-config default = пустые `rules`) +
project-local `$schema` через `generateConfigSchema({customRules})`; P7 — MCP-инструменты +
потребитель `relativizeImpact` + error-taxonomy; P8 — `--fix` для SEC-002/SEC-003 (сейчас
`fixable:false`, движок только document-scope).

---

## 4. 🔴 Межфазная находка — владение frontmatter-схемой SKILL.md (S1)

**Это ключевая находка аудита, потому что она затрагивает две фазы и порядок работ.**

- [P5.04](docs/mdlint_v2/P5-compile/04-synthesize.md) требовал «validate … against **the shared
  SKILL.md schema**» и объявлял это в exit-критериях — **как будто схема уже существует**.
- [P8.01](docs/mdlint_v2/P8-skills/01-frontmatter-schema-model.md) заявлял, что **определяет**
  frontmatter-схему.
- В коде **никакой frontmatter/SKILL.md Zod-схемы нет** (grep пуст). Требование S1 говорит, что
  схема — единый источник и для вывода компилятора (P5), и для CI статических скиллов (P8/P9), но
  фазу-владельца не назначает.

Порядок фаз — `P5 → P7 → P8`. P5.04 генерирует `SKILL.md` **раньше**, чем существует P8. Значит,
схема обязана существовать к P5. Толкать её в P8 нельзя (иначе P5 нечем валидировать, а P7.04
`compile-context` зависит от P5).

**Разрешение (применено к докам):** frontmatter-схему **определяет и экспортирует P5.04** (её
первый потребитель); [P8.01](docs/mdlint_v2/P8-skills/01-frontmatter-schema-model.md) её
**переиспользует** (не переопределяет), добавляя лишь unified skill model и CI-валидатор. Так S1
остаётся единым источником, а зависимость идёт по направлению порядка фаз.

---

## 5. Находки по фазам

Легенда статуса: **[док]** — исправлено правкой документа; **[код]** — оставлено как
follow-up для этапа реализации (см. §7); **[инфо]** — зафиксировано, правки не требует.

### P5 — Context compiler & `compile`

| # | Severity | Находка | Статус |
| --- | --- | --- | --- |
| **S01** | Blocking | P5.05 утверждал, что compile-секция конфига «validated in P2.04». На деле P2.04 намеренно оставил `compile: z.unknown().optional()` — форму определяет и валидирует **P5.05**. | **[док]** |
| **S02** | Blocking | Список категорий `describeRules` дробил CTX на «Checklist» + «Content Quality» и **терял SIZE**. Реальность: группировка по 8 кодам `RuleMetadata.category`; CHK нет, чек-лист = CTX-002. | **[док]** |
| **S03** | Medium | `compileContext(config: Config, …)` ссылался на несуществующий тип `Config`. Верно — `LoadedConfiguration`. | **[док]** |
| **S04** | High | Frontmatter-схема (S1) — см. §4. P5.04 теперь её **создаёт и экспортирует**. | **[док]** |
| **S05** | Medium | P5.03 не упоминал уже существующий `generateRuleDocs` — риск параллельного чтения метаданных. Добавлено указание переиспользовать `ruleRegistry.getAllMetadata()`. | **[док]** |
| **S06** | Low | Сигнатура `describeRules(config.rules)` смешивала «какие правила включены» и «откуда описания». Уточнено на `describeRules(configuredRules, registry)`. | **[док]** |
| **S07** | Medium | `analyzeGraph` брал только `readingOrder`, молча теряя `topologicalSort().excluded` (узлы, выброшенные циклом). Нарушало бы честность G6. Теперь тянет `excludedFromReadingOrder` + `cycles`. | **[док]** |
| **S08** | Low | Порог hub читает `inDegree` **с сохранённой кратностью рёбер** (id-ref-раздувание, P4-AUDIT A/H) — считает ссылки, не уникальных referrer'ов. | **[инфо]** (осознанно для v2) |
| **S09** | Low | Оценщик бюджета цитировался как «(P3.07)» — это правило LLM-001, не модуль оценщика. Верно — `estimateTokens` в `engine/tokens.ts` (D3). | **[док]** |
| **S10** | Low | В index-таблице P5.03 «Depends on P5.01», хотя реальная зависимость — метаданные (P2.03). Исправлено. | **[док]** |
| **S11** | Info | Журнал `p1-p3-execution-notes.md` сам содержит устаревшее «22» и «`compile: type:object`» — историческая запись, не задача P5. | **[инфо]** |

### P6 — `init`

| # | Severity | Находка | Статус |
| --- | --- | --- | --- |
| **I01** | High | P6.03 считал `@inquirer/prompts` установленной зависимостью «(P0.05)». На деле P0.05 её только **зарезервировал**; в `cli` сейчас лишь `commander`. P6 должен её **добавить**. | **[док]** |
| **I02** | Medium | Локированное C4 говорило «22-rule config». Реестр содержит **24** правила. Исправлено в `requirements/01-configuration.md`. | **[док]** |
| **I03** | Medium | Пример маппинга категория→правило (`ref→REF-001/002/003, tbl→TBL-002, ctx→CTX-001/002, grp→GRP-001/002`) устарел и опускал половину категорий. Заменён на все 8 категорий + указание группировать `getAllMetadata()`. | **[док]** |
| **I04** | Medium | Критерий «lints cleanly on a fresh repo» смешивал валидность конфига и ноль findings. Реальный ruleset может законно давать findings. Критерий разделён (валидность загрузки vs exit 0 на чистой фикстуре). | **[док]** (index + P6.05 + roadmap) |
| **I05** | Medium | Скан/инференс/генерация текста конфига не имели указанного «дома» пакета. По core-hosts-the-pipeline — это core (чистые, тестируемые, переиспользуемые скиллом P8), CLI = только промпты + запись файла. Добавлена секция «Package placement» в index P6. | **[док]** |
| **I06** | Info | Шорткат `-init` vs каноническое `wastech-mdlint-init` — приемлемо, правки не требует. | **[инфо]** |

**Подтверждено верным (без правок):** `generateConfigSchema({customRules})`, `CONFIG_FILE_NAME`,
локальный `$schema` без remote URL, отсутствие предположения о C6-пресетах, соблюдение
«no install-time writes».

### P7 — MCP server

| # | Severity | Находка | Статус |
| --- | --- | --- | --- |
| **M01** | High | P7.01 ссылался на CLI `shared.ts`/`resolveCwd`/`resolveConfig` — их нет. Реальная цепочка: `loadConfiguration({cwd, explicitConfigPath})` → `loadContext({cwd, config, settings})`. | **[док]** |
| **M02** | High | P7.02 ссылался на `loadConfig` — нет такого экспорта (это `loadConfiguration`); `lintFiles` берёт resolved-конфиг, не путь. | **[док]** |
| **M03** | High | Структура `context-slice` не совпадала с `ContextSliceResult` (`matchType`→`matchKind`; нет `totalFiles`/`summary`; опущены `starts`/`visited`). | **[док]** |
| **M04** | High | Структура `impact-analysis` не совпадала с `ImpactClassification` (`changedFile`→`file`; нет `summary`; опущены `readingOrder`/`excluded`). | **[док]** |
| **M05** | Medium | P7.04 опирается на несуществующие символы P5 (`compileContext`/`CompileResult`/`CompileConfigMissingError`). Добавлен баннер «Blocked on P5, сверить имена». | **[док]** |
| **M06** | Medium | P7.01 недоописывал уже существующий stub и подавал его инварианты как новую работу. Добавлено «Extend, don't rebuild». | **[док]** |
| **M07** | Low | «Depends on P2/P4/P5» для всей фазы избыточно — P5 нужен только P7.04. Сужено. | **[док]** |
| **M08** | Low | `resolveRule` — метод `RuleRegistry`, не barrel-функция. Уточнено на `ruleRegistry.resolveRule(...)`. | **[док]** |
| **M09** | Low | Не описан override: явный `patterns` = `config.include = patterns`. Добавлено. | **[док]** |
| **M10** | Low | Структура `context-graph` теряла `cycles`; путал text-formatter и структурный summary. Уточнено (`{nodes,edges,cycles}` + `summarizeContextGraph`). | **[док]** |
| **M11** | Info | SDK: регистрировать через `registerTool` (deprecated `tool()` не несёт `outputSchema`). Добавлено в конвенции P7.01. | **[док]** |

**Подтверждено верным:** контракт из 6 инструментов и отсутствие `fix`/`schema` (M5 backlog),
инварианты stdio-only/read-only/no-code-plugins, честность `SLICE_RESOLUTION_DESCRIPTION`.

### P8 — Static skills

| # | Severity | Находка | Статус |
| --- | --- | --- | --- |
| **K01** | Blocking | P8.03 обещал core `--fix` для «**SEC-\***». Реальный fixable-subset — **только SEC-001 + TBL-002**; SEC-002/SEC-003 — `fixable:false`; движок `--fix` — только document-scope. Скилл не должен обещать то, чего core не делает. | **[док]** |
| **K02** | Medium | P8.03 ссылался на несуществующее семейство `CHK-*` и опускал `STR-*`. CHK нет (чек-лист = CTX-002); STR-001 — project-scope, не auto-fix. | **[док]** |
| **K03** | Low | «generated fix table» — это таблица README (`generateRuleDocs` + docs-sync), а не CLI-команда. Уточнено. | **[док]** |
| **K04** | Low | P8.04 «highlight hubs/cycles» — в JSON `impact` нет `hubs`; «cycles» = `excluded`. Приведено к реальным полям. | **[док]** |
| **K05** | Info | Имя MCP-инструмента `impact-analysis` верно; поверхность появится в P7 — зависимость учтена. | **[инфо]** |
| **K06** | Info | P8.02 оборачивает CLI `init` (P6), которого ещё нет — порядок фаз честно учтён. | **[инфо]** |
| **K07** | Low | В index ссылки «Depends on P6/P7» вели на roadmap, а не на index-файлы фаз. Исправлено. | **[док]** |
| **K08** | Low | Диаграмма последовательности переоценивала пререквизиты P8.01. Добавлена заметка про пофазные зависимости. | **[док]** |

**Подтверждено верным:** vendor-neutral distribution, ровно 3 скилла (S9 4-й отложен), коды выхода,
все кросс-ссылки резолвятся.

### P9 — Distribution, CI & release

| # | Severity | Находка | Статус |
| --- | --- | --- | --- |
| **R01** | Blocking | P9.01 описывал разрешение `workspace:*` на publish — **фикция**. Внутренние deps — литерал `"0.0.0"` (npm workspaces). Реальная опасность обратная: релиз-тул должен синхронно бампать версию **и** внутренние пины. Переписано. | **[док]** |
| **R02** | High | P9.01 подавал уже готовые метаданные (provenance, `publishConfig`, `files`, shipped `schema.json`) как несделанную работу. Переформулировано в verify-not-build. | **[док]** |
| **R03** | Medium | P9.05 вручную переизобретал существующий root-скрипт `release:check` и job `publish-readiness` в `publish.yml`. Даны ссылки на существующее. | **[док]** |
| **R04** | Medium | P9.04 «Rewrite README» — README уже v2 (P3.09). Реальный пробел — отсутствие MCP/skill каналов установки. Переименовано в «polish + add channels». | **[док]** |
| **R05** | Medium | P9.04 просил обновить AGENTS.md «Sources Of Truth» — уже сделано. Понижено до «verify». | **[док]** |
| **R06** | Low | «MCP tool list are generated» — генератора нет; сгенерирована только таблица правил. Помечено как новая работа P7/P9. | **[док]** |
| **R07** | Low | «full workspace matrix on Node 24» — CI гоняет одну закреплённую версию Node (`.node-version`); матрица только у `pack` (по 3 пакетам). Уточнено + отмечен baseline `ci.yml`/`publish.yml`. | **[док]** |
| **R08** | Info | «audit P9 engines gap» — уже закрыт (`>=24.17.0` без верхней границы во всех пакетах). Снято. | **[док]** |
| **R09** | Info | «per-package exports» — `exports` только у core; cli/mcp bin-only. Уточнено. | **[док]** |

---

## 6. Сквозной дрейф в roadmap / requirements

Корень дрейфа таксономии правил — в верхнеуровневом [docs/mdlint_v2/index.md](docs/mdlint_v2/index.md):

- §1 объявлял «22 built-in … across **7 categories** (…, **`CHK`**, …)». Категории `CHK` не
  существует; чек-лист — это `CTX-002`. Формулировка «22» — это легитимная рамка D3 (22
  doc-integrity правила), но 7 категорий и `CHK` — ошибка. Исправлено: **22 doc-integrity в 6
  категориях + SIZE-001 + LLM-001 = 24 встроенных в 8 категориях всего**.
- §6 «Phase 3» перечисляла `3b SEC (001–002)`, `3e CHK (001)`, `3f CTX (001–002)` — устаревшее до
  слияния CHK→CTX и до SEC-003. Исправлено на SEC (001–003), CTX (001–003, вкл. CTX-002), убран CHK.
- §3 таблица и §4 диаграмма уточнены в рамках той же «22 doc-integrity»-конвенции: §3 →
  «22 built-in rules (+ SIZE-001/LLM-001, D3)», §4 → «22 built-in rules + SIZE/LLM + custom»
  (раньше §4 опускал SIZE). Единственный якорь, поясняющий «= 24 всего», — §1; конвенция «22»
  осознанно сохранена по всему документу (§3.1/§5/§6/§10), чтобы не переписывать нарратив
  завершённых P2/P3.
- §6 «Phase 6» exit «lints cleanly on a fresh repo» приведён к разделённой формулировке (см. I04).

`requirements/01-configuration.md` C4 «22-rule» → «24 built-in» (см. I02).

> Замечание по объёму: прочие упоминания «22 built-in» в §6/§10/Appendix (описания уже завершённых
> P2/P3) оставлены как рамка «doc-integrity», которую §1 теперь явно поясняет. Полный свип
> исторических формулировок P2/P3 — вне области этого аудита.

---

## 7. Code-follow-up (проверить/сделать на этапе реализации)

Не документные правки, а то, что реализатор обязан держать в голове (часть уже зафиксирована прямо
в доках как заметки):

1. **P5.05:** заменить `compile: z.unknown()` на строгую схему `{ outdir?, skill:{name,description},
   sections?, commandPreset?, hubMinInDegree? }` с `.strict()`.
2. **P5.04:** определить и **экспортировать** frontmatter Zod-схему из core (первый потребитель) —
   P8 её переиспользует (§4).
3. **P7.04:** перед реализацией сверить имена `compileContext`/`CompileResult`/
   `CompileConfigMissingError` с `packages/core/src/index.ts` (они появятся в P5).
4. **P7:** регистрировать инструменты через `server.registerTool(...)` (не deprecated `tool()`);
   структурный вывод обязан 1:1 совпадать с `ContextSliceResult`/`ImpactClassification`/`ContextGraph`.
5. **P6:** добавить `@inquirer/prompts` в `@wastech-mdlint/cli`; чистые функции скана/инференса
   разместить в core.
6. **P9.02:** релиз-тул должен атомарно бампать версию **и** внутренние пины `@wastech-mdlint/*`
   (нет `workspace:*` для авторазрешения).
7. **P9.04:** добавить генератор списка MCP-инструментов в `scripts/generate-docs.mjs` + sync-тест.
8. **backlog (не фаза):** замена эвристики `estimateTokens = ceil(len/4)` (изолирована в
   `engine/tokens.ts`); ограничение id-ref скана прозой (P4-AUDIT A/H) — влияет на точность
   hub-порога компилятора (S08).

---

## 8. Приложение — изменённые файлы

Правки — только документация; продуктовый код не тронут.

| Область | Файлы |
| --- | --- |
| Roadmap / requirements | [index.md](docs/mdlint_v2/index.md), [requirements/01-configuration.md](docs/mdlint_v2/requirements/01-configuration.md) |
| P5 compile | [index.md](docs/mdlint_v2/P5-compile/index.md), [01-graph-analysis.md](docs/mdlint_v2/P5-compile/01-graph-analysis.md), [03-describe-rules.md](docs/mdlint_v2/P5-compile/03-describe-rules.md), [04-synthesize.md](docs/mdlint_v2/P5-compile/04-synthesize.md), [05-compile-config-cli.md](docs/mdlint_v2/P5-compile/05-compile-config-cli.md) |
| P6 init | [index.md](docs/mdlint_v2/P6-init/index.md), [02-rule-inference.md](docs/mdlint_v2/P6-init/02-rule-inference.md), [03-interactive-prompts.md](docs/mdlint_v2/P6-init/03-interactive-prompts.md), [05-init-tests.md](docs/mdlint_v2/P6-init/05-init-tests.md) |
| P7 mcp | [index.md](docs/mdlint_v2/P7-mcp-server/index.md), [01-server-foundation.md](docs/mdlint_v2/P7-mcp-server/01-server-foundation.md), [02-lint-tools.md](docs/mdlint_v2/P7-mcp-server/02-lint-tools.md), [03-graph-tools.md](docs/mdlint_v2/P7-mcp-server/03-graph-tools.md), [04-compile-tool.md](docs/mdlint_v2/P7-mcp-server/04-compile-tool.md) |
| P8 skills | [index.md](docs/mdlint_v2/P8-skills/index.md), [01-frontmatter-schema-model.md](docs/mdlint_v2/P8-skills/01-frontmatter-schema-model.md), [03-skill-fix.md](docs/mdlint_v2/P8-skills/03-skill-fix.md), [04-skill-impact.md](docs/mdlint_v2/P8-skills/04-skill-impact.md) |
| P9 release | [index.md](docs/mdlint_v2/P9-release/index.md), [01-package-metadata.md](docs/mdlint_v2/P9-release/01-package-metadata.md), [03-github-action.md](docs/mdlint_v2/P9-release/03-github-action.md), [04-docs-readme.md](docs/mdlint_v2/P9-release/04-docs-readme.md), [05-release-verification.md](docs/mdlint_v2/P9-release/05-release-verification.md) |

**Итого: 25 файлов** (только `.md`, только фазы P5–P9 и их сквозные источники).

---

## 9. Рекомендация по порядку реализации

Порядок дорожной карты остаётся `P5 → P6 → P7 → P8 → P9`, с двумя уточнениями от этого аудита:

1. **P5 должен появиться до P7.04 и до P8.01** (frontmatter-схема + compile-типы) — уже отражено в
   зависимостях.
2. **P7.02/P7.03 (5 из 6 инструментов) не зависят от P5** — если P5 задержится, MCP можно начать без
   `compile-context`. Отражено в сужении зависимостей P7.01.
