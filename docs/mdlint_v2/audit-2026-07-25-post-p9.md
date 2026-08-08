# Аудит после P9/P10 — находки, пропущенные отчётом `p9-09`

> **Language / Язык:** this report is in **Russian**, and it is **frozen as written** — it is the definition site for the finding IDs (`H-1` … `L-11`) the [P11](P11-remediation/index.md) and [P12](P12-consistency/index.md) task files are written in, and section 4 is where the four process-boundary guard categories in [`.agents/rules/testing.md`](../../.agents/rules/testing.md) get their justification. Re-wording either would move the vocabulary out from under the plan and the testing rules at once. For readers who need this in English, [Appendix A](#appendix-a-english-finding-index) glosses every finding ID **and** section 4's systemic cause; the Russian body above it is untouched.

> **Дата:** 2026-07-25 · **Ветка:** `feat/p9-remediation` · **Охват:** выборочный перепроход по подсистемам, которые отчёт `docs/research/p9-09-full-solution-deep-audit/report.md` пометил как пройденные, но фактически не читал · **Метод:** независимый разбор прогона `deep_research` + повторный аудит кода с воспроизведением дефектов запуском собранного CLI и движка.

---

## 1. Зачем этот документ

Отчёт `p9-09` вынес вердикт **«no HIGH / release-blocking defect was found»** и пометил подсистемы «CLI + init» и «Generated schema» как _walked; no findings_. Разбор его исполнения показал, что узел анализа открыл **61 файл из 331** в охвате задачи (18 %): `packages/cli/src/index.ts`, `packages/cli/src/init-command.ts` (836 строк — весь путь записи `init`), `packages/cli/schema.json`, 9 из 12 файлов MCP-сервера и 56 из 60 тестовых файлов не открывались ни разу, хотя все они перечислены в описании задачи и все были видны агенту в выводе его собственного `Glob`.

Перепроход по этой непрочитанной поверхности дал **22 находки, включая 4 HIGH**, две из которых — release-blocking. То есть вердикт отчёта был не нейтральным, а **отрицательным**: он выдал ложную гарантию по подсистеме, которую не читал.

Причины на стороне оркестратора (не этого репозитория) разобраны отдельно и здесь не повторяются. Этот документ — только про продукт.

### Состояние проверочных гейтов на ветке

Прогнано на `feat/p9-remediation` 2026-07-25:

| Гейт | Результат |
| --- | --- |
| `npm run typecheck` | ✅ проходит |
| `npm run lint` (eslint) | ✅ чисто |
| `npm test` | ✅ 614/614 тестов, 60 файлов |
| `npm run build` | ✅ проходит |
| `npm run format` (prettier --check) | ❌ **4 файла не отформатированы** — см. ниже |

Красный гейт форматирования — не унаследованный шум, а свежая регрессия, и **половину её внёс сам аудит `p9-09`**:

| Файл | Внесён коммитом |
| --- | --- |
| `docs/research/p9-09-full-solution-deep-audit/report.md` | `242a518` — деливерабл `p9-09` |
| `.../report-structure.md` | `242a518` — деливерабл `p9-09` |
| `docs/mdlint_v2/P10-consistency/05-test-depth.md` | `1eb8529` — P10.05 |
| `packages/core/test/registry-inventory.test.ts` | `21cd2cc` — P10.04 |

То есть после P9.06, который специально добавил `npm run format` в CI-матрицу, ветка красная против собственного гейта, и последним его сломал документ, чья задача была найти проблемы. Ни один из этих трёх прогонов гейт форматирования не запускал. Чинится одним `npx prettier --write .`, но стоит понять, почему проверка не выполняется до публикации.

### Достоверность находок

| Метка | Что означает |
| --- | --- |
| **выполнено** | дефект воспроизведён запуском собранного CLI / движка на специальной фикстуре |
| **по коду** | подтверждён чтением кода и трассировкой, без запуска |

---

## 2. Находки по убыванию важности

Severity: **HIGH** — ломает поведение/релиз · **MEDIUM** — заметное расхождение или скрытый риск · **LOW** — косметика, документация, точечные пробелы тестов. Категории — те же четыре, что и в `p9-09`: бизнес/логический дефект, техническая проблема, упущение, недоработка.

### 🔴 HIGH

#### H-1. Опубликованный `bin` — молчаливый no-op при установке через npm-симлинк

- **Категория:** бизнес/логический дефект (release-blocking). **выполнено**
- **Где:** `packages/cli/src/index.ts:8-16`; тот же паттерн в `packages/mcp-server/src/index.ts:52-57`.
- **Суть:** guard сравнивает `path.resolve(process.argv[1])` с `fileURLToPath(import.meta.url)`. `process.argv[1]` содержит путь **симлинка**, а `import.meta.url` — realpath; `path.resolve` симлинки не разыменовывает. npm/pnpm/yarn ставят `bin` симлинком на POSIX, поэтому условие никогда не выполняется и процесс завершается с кодом 0, не сделав ничего.
- **Воспроизведение** (на этой ветке, собранный `dist`):
  ```
  $ ./node_modules/.bin/wastech-mdlint --version     → (пусто)   exit=0
  $ npx wastech-mdlint --version                     → (пусто)   exit=0
  $ node packages/cli/dist/index.js --version        → 0.0.0     exit=0
  ```
- **Почему важно:** мертвы `npm i -g @wastech-mdlint/cli` и `npx`. Отдельно — **CI-workflow, который генерирует сам `init`** (`packages/core/src/discovery/config-writer.ts:177` выдаёт `npx wastech-mdlint lint --fail-on error`), поэтому каждая сгенерированная CI-джоба проходит зелёной независимо от находок линтера. Windows-шимы (`.cmd`) передают реальный относительный путь и, вероятно, работают — кросс-платформенное расхождение в репозитории, где кросс-платформенность заявлена инвариантом.
- **Почему прошло:** ни один тест не спавнит бинарник — `grep -rn "spawn|execFile|child_process" packages/cli/test packages/core/test` пусто, у `src/index.ts` покрытие 0 %, при 130/130 зелёных тестах CLI.
- **Направление:** разыменовывать симлинк (`fs.realpathSync(invokedPath)`) перед сравнением, либо убрать guard и вынести импорт-безопасность иначе. Обязательно — первый в репозитории тест, который реально запускает установленный `bin`.

#### H-2. `SEC-003` читает произвольные файлы вне корня анализа

- **Категория:** технический дефект (безопасность). **выполнено**
- **Где:** `packages/core/src/engine/rules/sec.ts:99-114`, ключевая строка `:109`:
  ```ts
  const content = readFileSync(path.resolve(rootDir, templatePath), "utf8");
  ```
- **Суть:** проверки пути нет вообще; `sec.ts` даже не импортирует `escapesRoot`, тогда как соседний примитив это делает — `packages/core/src/engine/primitives/reference.ts:30` и `:141` (хелпер в `packages/core/src/engine/path-resolve.ts:27-29`). При абсолютном `templatePath` `path.resolve` полностью игнорирует `rootDir`.
- **Воспроизведение:** `template: "../<вне-корня>/secret.md"` → findings содержат заголовки из файла вне проекта; `template: "/etc/hosts"` → в вывод линтера попадает каждая строка, начинающаяся с `#`, что покрывает shell-скрипты, Dockerfile, YAML, комментарии `.env`, CI-конфиги; `template: "/etc/definitely-not-here"` → сообщение _"template … was not found"_, то есть чистый oracle существования произвольного абсолютного пути.
- **Почему важно:** MCP-инструмент `lint` принимает массив `rules` целиком от вызывающего и ставит `rootDir: process.cwd()` (`packages/mcp-server/src/tools/lint.ts:150`). Агент под prompt-injection превращает read-only линтер в примитив чтения хоста. Нарушает `.agents/rules/security.md` («keep reports bounded to the analyzed repository state», «do not dump … unrelated local filesystem data into diagnostics»). Описание инструмента (`lint.ts:194-197`) обещает пути «relative to the server's working directory» — это тот самый артефакт, который правила M-3 уже приводили в порядок.
- **Направление:** отклонять абсолютные пути и `..`-выход для `template` (одного `escapesRoot` мало — он ловит только относительный выход, но не абсолютный путь); привести описание MCP-инструмента в соответствие; тест на обе формы обхода.

#### H-3. `findConfig` идёт вверх до корня ФС — `init` перезаписывает конфиг постороннего предка

- **Категория:** бизнес/логический дефект (потеря данных вне проекта). **выполнено**
- **Где:** `packages/core/src/config/find-config.ts:21-37` (обход без границы); потребитель — `packages/cli/src/init-command.ts:604-619`, который переопределяет `cwd` на `path.dirname(existingConfigPath)`.
- **Воспроизведение:** `init .` внутри нового пустого подпроекта перезаписал конфиг **родительского каталога** (`"include":["parent-only.md"]` уничтожен) и в целевой каталог не записал ничего.
- **Две усугубляющие детали:**
  1. Граница непоследовательна: `findRepositoryRoot` (`init-command.ts:419-450`) и `findInstalledSchemaDir` (`:459-467`) обрезаются на `os.homedir()` с развёрнутым комментарием ровно про эту опасность. Не ограничен именно тот обход, который решает, **какой файл затирать**.
  2. Пользователю всегда показывается голое имя файла: `relativeConfigPath` (`init-command.ts:616-619`) считается как `path.relative(cwd, existingConfigPath)` **после** переназначения `cwd` на каталог этого же конфига, поэтому `../../wastech-mdlint.config.json` отрисоваться не может. Промпт (`init-prompter.ts:44`) говорит «An existing config was found at `wastech-mdlint.config.json`», даже когда он тремя каталогами выше.
- **Дополнительно:** аргумент `[path]` молча игнорируется, если у любого предка есть конфиг — `init packages/foo --yes --on-existing overwrite` перезаписал корневой конфиг репозитория и ничего не создал под `packages/foo`. `docs/guide/cli.md` документирует `[path]` как «Directory to scan», про переопределение корня не сказано.
- **Направление:** ограничить обход границей репозитория (или `os.homedir()`, как у соседей); показывать пользователю путь относительно исходного `cwd`; либо не переопределять корень по найденному предку, когда `[path]` задан явно.

#### H-4. `init` затирает существующий `schema.json` без проверки и предупреждения

- **Категория:** бизнес/логический дефект (потеря данных). **выполнено**
- **Где:** `packages/cli/src/init-command.ts:783-789` — `writeFile(schemaPath, …)` без `fileExists()`-guard.
- **Асимметрия и есть баг:** запись CI-workflow на 280 строк выше **guard имеет** (`init-command.ts:505-507`) и покрыта отдельным тестом (`init.e2e.test.ts:1017` «never overwrites an existing CI workflow file»).
- **Воспроизведение:** пользовательский `schema.json` на 44 байта заменён сгенерированным на 70 055 байт после `init . --yes --on-existing merge`.
- **Почему важно:** `schema.json` — крайне распространённое имя, и сам `wastech-mdlint schema` по умолчанию пишет в `--out schema.json`. Нарушает инвариант, процитированный в самом модуле (`init-command.ts:39`, «I1's 'no implicit file-clobbering' spirit») и требование **I1** в `docs/mdlint_v2/requirements/06-installation.md`. Тестов нет.
- **Направление:** тот же guard, что у CI-workflow, плюс явное сообщение в сводке записи.

---

### 🟠 MEDIUM

#### M-1. `REF-004` подставляет имя каталога в `RegExp` без экранирования — необработанный краш

- **Категория:** техническая проблема. **выполнено**
- **Где:** `packages/core/src/engine/rules/ref.ts:242`:
  ```ts
  new RegExp(`(^|[^A-Za-z0-9_-])${zone}([^A-Za-z0-9_-]|$)`).test(body);
  ```
  `zone` — имя каталога из `context.projectFiles` (`:221-226`).
- **Воспроизведение:** каталог `c++` → `SyntaxError: Invalid regular expression … Nothing to repeat`, весь прогон линтера падает стектрейсом вместо структурированной диагностики; каталог `we)ird` → `Unmatched ')'`. Каталог вида `node.js` или `v2(beta)` не падает, но даёт **молча неверные совпадения** (`.` матчит любой символ, скобки становятся группой).
- **Правильный хелпер — в 170 строках оттуда, в том же пакете:** `packages/core/src/engine/rules/ctx.ts:70-73` экранирует ровно это. Отдельно: `:242` пересобирает regex внутри тройного вложенного цикла (документы × заголовки × зоны).
- **Направление:** экранировать `zone` тем же хелпером; вынести компиляцию из цикла.

#### M-2. `columnUnique` игнорирует `exclude`, если не задан `files` — ложные findings уровня `error`

- **Категория:** бизнес/логический дефект. **выполнено**
- **Где:** `packages/core/src/engine/primitives/table.ts:267`:
  ```ts
  if (options.files !== undefined && !fileMatches(document.path)) continue;
  ```
  `fileMatches` = `matchesFileScope(path, options)` и честно учитывает **и** `files`, **и** `exclude` (`rules/tbl.ts:286`, `rules/custom.ts:109`) — но вызывается только когда есть `files`.
- **Воспроизведение** (два файла с одинаковым `REQ-1`):

  | конфиг | результат |
  | --- | --- |
  | `{"column":"ID","exclude":["archive/**"]}` | **`archive/old.md:3 Duplicate value "REQ-1"` — ложное срабатывание** |
  | `{"column":"ID","files":["**/*.md"],"exclude":[…]}` | чисто |

- **Почему важно:** строго хуже, чем находка SC-1 из `p9-09` (та — признанный forward-compat no-op, который даёт молчание). Здесь недокументированный no-op даёт **ложные findings уровня `error`** в поставляемом правиле, и это же бьёт по любому декларативному `custom` с `columnUnique`. `exclude` документирован для TBL-006 в `docs/guide/rules/TBL-006.md:31`.
- **Направление:** вызывать `matchesFileScope` безусловно.

#### M-3. `{"rule":"custom"}` без `id` роняет загрузчик конфига голым `TypeError`

- **Категория:** техническая проблема. **выполнено**
- **Цепочка:** `packages/core/src/config/config-schema.ts:104-107` — упорядоченный union, поэтому запись с `rule:"custom"` без `id` проваливается мимо `customRuleEntrySchema` и принимается `ruleEntrySchema`; `packages/core/src/config/load-config.ts:122` ветвится на `entry.rule === "custom"` и кастует, после чего `resolveCustomRule` зовёт `canonicalizeRuleId(undefined)` → `packages/core/src/rule-id.ts:22` `raw.trim()`.
- **Воспроизведение:** `{"rules":[{"rule":"custom"}]}`, `{"rules":[{"rule":"custom","options":{…}}]}` и `{"rules":[{"rule":"custom","severity":"warning"}]}` — все дают `TypeError: Cannot read properties of undefined (reading 'trim')`. Для контраста `{"rule":"custom","id":"REQ-1"}` корректно даёт `ConfigError / CONFIG_INVALID`.
- **Почему важно:** смысл двухстадийной валидации, описанной в `load-config.ts:150-157`, — чтобы ошибки конфига выходили диагностикой C7. Самая вероятная опечатка автора (забыть `id`) обходит её и выходит стектрейсом.
- **Направление:** сузить union так, чтобы `rule:"custom"` всегда шёл в `customRuleEntrySchema`, либо проверять `id` до каста.

#### M-4. `exclude`, который пишет `init`, отсекает только шум в корне

- **Категория:** упущение. **выполнено**
- **Где:** `packages/core/src/discovery/config-writer.ts:96-98` — `DEFAULT_NOISE_DIR_NAMES` превращается в `${name}/**`; `normalizeConfigGlob` (`packages/core/src/discovery/globs.ts:7-15`) такие строки не переписывает, потому что в них уже есть `/`, поэтому они якорятся к корню.
- **Воспроизведение:** после `init --yes` в монорепозитории линтуются `packages/foo/dist/OUT.md` и `packages/foo/node_modules/somelib/README.md`.
- **Прямо противоречит комментарию в том же файле** (`config-writer.ts:91-95`), который обещает обратное **включая ровно этот случай**: «so a written config never re-scans the node_modules/.git/dist/… trees … including when `include` falls back to the implicit `**/*.md`». Встроенного списка шума у `loadDocuments` нет (`markdown/load-documents.ts:85-91` отсекает только по `exclude`), так что это единственная защита.
- **Направление:** `**/node_modules/**` вместо `node_modules/**`. Тест `config-writer.test.ts:93-94` сейчас проверяет только наличие литералов.

#### M-5. Записи `init` неатомарны — при сбое остаётся половинчатое, ничем не объявленное состояние

- **Категория:** техническая проблема. **выполнено**
- **Где:** `init-command.ts:783-789` — сначала конфиг, потом схема; ни temp+rename, ни отката, ни порядка, гарантирующего согласованность.
- **Воспроизведение** (`schema.json` только на чтение): `exit=1`, **stdout пуст** (сводки записи нет вообще), stderr — `EACCES … open '…/schema.json'`, а конфиг на диске **уже переписан** и его `$schema` теперь указывает на устаревший пользовательский файл.
- Так как `writeFile` — обычный truncate-and-write, краш или ENOSPC в середине записи так же усекает существующий конфиг пользователя без пути восстановления.
- **Направление:** temp-файл + rename; сообщать о том, что успело записаться, при частичном сбое.

#### M-6. Операционные сбои выходят с кодом 1 вместо 2 и печатают абсолютные пути

- **Категория:** недоработка (контракт CLI). **выполнено**
- **Где:** `packages/cli/src/program.ts:370-372` — всё, что не `CliUsageError`/`ConfigError`, маппится в `EXIT_CODE_RUNTIME_ERROR`.
- **Воспроизведение:** `wastech-mdlint init ./does-not-exist --yes` → `exit=1`, stderr `Unexpected error: ENOENT … open '/private/tmp/…/wastech-mdlint.config.json'`.
- **Почему важно:** `docs/guide/cli.md` §Exit codes и `docs/guide/output.md:30-36` резервируют **1** за «findings at or above `--fail-on`» и **2** за «operational/usage error». CI не может отличить «линтер нашёл проблемы» от «init не смог записать». Абсолютный путь нарушает инвариант repo-relative POSIX-вывода, на который сам код многократно ссылается (`init-command.ts:50-52`, `:539-541`, `commands.ts:421-425`).

#### M-7. Неизвестная подкоманда и несуществующий путь дают `exit 0 "No problems found."`

- **Категория:** недоработка. **выполнено**
- **Где:** `program.ts:111,138` — `lint` зарегистрирован с `{ isDefault: true }` и `.argument("[path]")`, поэтому любой неразобранный токен становится путём для `lint`.
- **Воспроизведение:** `wastech-mdlint bogus-command` → `exit 0`; `wastech-mdlint lint ./nope-missing` → `exit 0`.
- **Почему важно:** опечатка в CI-шаге проходит зелёной. `cli.test.ts:96-102` покрывает только неизвестную **опцию**, и его собственный комментарий («a bare positional becomes the lint [path]») документирует дыру, не проверяя её.

---

### 🟡 LOW

| ID | Находка | Достоверность |
| --- | --- | --- |
| L-1 | `CTX-003` теряет соседние вхождения алиаса: `ctx.ts:70-73` строит `(^\|[^A-Za-z0-9_])(alias)([^A-Za-z0-9_]\|$)` и потребляет граничные символы через `matchAll` (`:152`), поэтому два вхождения через один символ не могут совпасть оба. `api api api` → **2** находки. `docs/guide/rules/CTX-003.md:10` обещает «reports each occurrence». Нужен lookahead/`\b`. | **выполнено** |
| L-2 | Глоссарий требует `target` у `custom`-правила обязательным (`glossary.md:263-265`), тогда как код (`config-schema.ts:91` — `.optional()`), сгенерированная схема (`engine/schema.ts:88` — `required: ["rule","id","options"]`), сам `custom.ts:74` и гайд (`guide/rules/custom.md:38`, `:162`) единодушно считают его опциональным. | по коду |
| L-3 | `LLM-001` выдаёт побайтово одинаковые дубли findings — по одному на каждую точку входа (`llm.ts:128` вызывает `traverse()` на entrypoint, `:156-175` репортит `missing`/`cycles` из каждого обхода независимо). Два entrypoint'а с общим поддеревом дублируют одну и ту же диагностику; дедупликации в `lint-files.ts` нет. | **выполнено** |
| L-4 | У общей опции `exclude` **нулевое** end-to-end покрытие: `grep -c exclude` по `rules-tbl`, `rules-sec`, `rules-ctx`, `rules-ref`, `rules-grp`, `rules-str`, `rules-custom`, `primitives.test.ts` даёт 0 во всех восьми. Единственный юнит-тест хелпера (`rule-utils.test.ts:12-19`) проверяет `exclude` только вместе с `files` — рабочую комбинацию. Корень M-2. | по коду |
| L-5 | Квадратичные горячие пути: `compile/doc-profile.ts:93` зовёт `classifyNodes(graph, options)` на **каждый** документ, затем `:122-127` дважды фильтрует `graph.edges` — O(N²)+O(N·E) для `compileContext`. `engine/text-position.ts:5-16` `findLineNumber` сканирует с нулевого смещения на каждый вызов, а зовётся **на каждое совпадение**. | по коду |
| L-6 | `--fix` пишет неатомарно и только LF: `engine/fix.ts:90` — голый `writeFile` на документ (краш в середине портит Markdown пользователя); `rules/sec.ts:54` вставляет `\n## …\n\nTODO\n`, поэтому на CRLF-дереве получается смесь окончаний строк. | по коду |
| L-7 | `init` предлагает как кластеры документации скрытые и **gitignored** деревья: `discovery/repo-scan.ts:126` отсекает только `DEFAULT_NOISE_DIR_NAMES`, `.gitignore` не читается нигде. Наблюдалось попадание `.github/**`, `.venv/**` и `generated-docs/**` в `include`; так как записанный конфиг не задаёт `respectGitignore` (по умолчанию `false`), они линтуются. | **выполнено** |
| L-8 | `merge` молча уничтожает все комментарии JSONC — `config-writer.ts:365-371` пересериализует сохраняемые ключи через `JSON.stringify`. Признано внутри (`config-writer.ts:24-26`), но не сообщается: `formatWriteSummary` (`init-command.ts:553-556`) пишет только «Merged X: 1 new rule(s) appended», а `docs/guide/configuration.md:5` рекламирует комментарии как фичу. | **выполнено** |
| L-9 | Снятие всех кластеров в интерактиве инвертируется в «линтить весь репозиторий»: `init-command.ts:640-644` → `include: []` → `config-writer.ts:376` опускает ключ → `lintFiles` подставляет `**/*.md`. Фейковый промптер в тестах (`init.e2e.test.ts:103`) всегда возвращает все кластеры, поэтому случай не покрыт. | **выполнено** |
| L-10 | Записанный `$schema` — висячий путь в штатном `npx`-сценарии: `init-command.ts:773` при отсутствии локальной зависимости даёт `./node_modules/@wastech-mdlint/cli/schema.json`, которого нет. Шесть тестов проверяют саму строку (`init.e2e.test.ts:391,425,706,805,875,916`), ни один — что цель существует. | **выполнено** |
| L-11 | Мелочи: `schema --out <относительный>` резолвит от `process.cwd()`, а не от io-seam `cwd` (`commands.ts:356`, при том что `handleCompile` тот же класс багов уже починил на `:384-391`); `pnpm-workspace.yaml` обрезается на первой пустой строке (`workspace-packages.ts:82-84`); `detectPackageManager` смотрит только в корень (`package-manager.ts:28-52`); `readExistingRuleIds` (`init-command.ts:237-247`) не имеет продакшн-вызывающего и держится 11 тестами на 127 строк; два пути отказа от CI-workflow (`init-command.ts:500-507`) возвращают `undefined` молча; нет обработчика top-level rejection в bin (`index.ts:14`). | по коду |

---

## 3. Что перепроверено и признано чистым

Чтобы это не пере-аудировали:

- **Дрейфа `packages/cli/schema.json` относительно реестра правил нет** — файл побайтово равен выводу `generateConfigSchema()` (55 611 байт), и это закреплено двумя тестами (`schema-generation.test.ts:20`, `registry-inventory.test.ts:11-35`). Классический баг протухшего сгенерированного артефакта здесь действительно закрыт.
- **Детерминизм.** `localeCompare` в `src` отсутствует полностью, `compareStrings` используется везде, все проверенные сортировки — по кодовым точкам. Порядок файлов, кластеров, пакетов и ключей конфига стабилен между прогонами.
- **Байты и окончания строк.** Всё, что пишет `init`, — LF-only с завершающим переводом строки, без BOM; относительная математика `$schema` (`config-writer.ts:77-89`) корректна на Windows.
- **Записанный конфиг реально валиден против схемы, которую генерирует этот же код** — проверено ajv'ом против вывода `wastech-mdlint schema`; `loadConfiguration` его принимает, ветки `oneOf` не пересекаются.
- **Симлинк-циклы не вешают сканирование** — `repo-scan.ts:107-141` и `workspace-packages.ts:113-150` опираются на `Dirent.isDirectory()`, который для симлинка ложен; реальный цикл `docs/loop -> repoRoot` отрабатывает нормально.
- **Битые `package.json` и lock-файлы не роняют сканирование** (`workspace-packages.ts:12-21`, `package-manager.ts:11-20`).
- **Гейты безопасности `merge` действительно тщательные** — неразбираемый JSONC, не-массив `rules`, неопознаваемая запись и «не загрузится через `loadConfiguration`» прерывают операцию без записи, каждый случай покрыт e2e-тестом с проверкой побайтовой неизменности файла.
- **`TP-1` из `p9-09` — действительно единственный экземпляр своего класса.** Модульные `g`-регулярки (`parse-document.ts:43`, `build-context-graph.ts:52`) используются только через `matchAll`, который `lastIndex` не разделяет.
- **Тесты зелёные:** 614 тестов, 60 файлов.

---

## 4. Системная причина, а не список совпадений

Отчёт `p9-09` брал каждую находку как единичный случай, а не как класс для прочёсывания:

- нашёл один инертный параметр (SC-1) и остановился — худший лежал в `table.ts:267` (**M-2**);
- нашёл одну проблему дублирующихся findings (SC-2) и остановился — точные дубли лежали в `llm.ts:156` (**L-3**);
- нашёл одну проблему с regex (TP-1) и остановился — краш от неэкранированной подстановки лежал в `ref.ts:242` (**M-1**), а потеря соседних совпадений — в `ctx.ts:71` (**L-1**).

Плюс отдельный класс: **отсутствие тестов на границе процесса**. `src/index.ts` не покрыт вообще (H-1), у `exclude` нет ни одного e2e-теста (L-4, корень M-2), ни один тест `init` не проверяет сценарий сбоя записи (M-5) и ни один не спавнит бинарник.

---

## 5. Куда вынесены находки

| Находка | Куда |
| --- | --- |
| H-1 | задача `p11-01-cli-bin-noop` (`tasks/pending/`) — release-blocking, чинить первой |
| H-2 | задача `p11-02-sec003-path-escape` (`tasks/pending/`) — release-blocking + безопасность |
| H-3 … L-11 | пока только этот документ; при планировании фазы P11 разложить по задачам в порядке ниже |

---

## 6. Приоритизированный план действий

**Немедленно (HIGH, release-blocking):**

1. **H-1** — разыменование симлинка в `bin` + первый тест, который реально спавнит бинарник. Пока не починено, `npx`/глобальная установка не работают, а генерируемая `init`-ом CI-джоба зелёная всегда.
2. **H-2** — запрет абсолютных и выходящих за корень `template` в `SEC-003` + приведение описания MCP-инструмента в соответствие.

**Следом (HIGH, потеря данных в `init`):**

3. **H-4** — guard на существующий `schema.json` (симметрично CI-workflow).
4. **H-3** — граница обхода `findConfig` + честный путь в промпте.

**Потом (MEDIUM):** **M-2** и **M-1** первыми (ложные `error`-findings и краш прогона), затем **M-3**, **M-4**, **M-5**, и парой — **M-6**/**M-7** (контракт кодов возврата и поглощение неизвестной подкоманды; обе бьют по CI одинаково).

**LOW:** брать вместе с соседним MEDIUM в той же подсистеме. Отдельно стоит **L-4** — нулевое e2e-покрытие `exclude` по ~15 правилам; это корень M-2 и самая дешёвая профилактика того же класса.

---

## Appendix A: English finding index

Added by [P17.06](P17-plan-of-record/06-register-and-roadmap.md) so a reader without Russian can resolve an ID the P11/P12 task files cite, and so the systemic cause the testing rules rest on is readable in the language those rules are written in. **This is an index, not a translation:** each row is a one-line gloss, and the Russian entry stays authoritative wherever the two could be read differently. Confidence verdicts, evidence, and file/line citations are in the body.

| ID | Severity | Finding (gloss) |
| --- | --- | --- |
| H-1 | HIGH, release-blocking | The published `bin` is a silent no-op through an npm symlink: the entrypoint guard compares `import.meta.url` against an unresolved `process.argv[1]`, so `npx` and a global install do nothing and exit `0`. |
| H-2 | HIGH, release-blocking + security | `SEC-003` reads arbitrary files outside the analyzed root: an absolute or `..`-climbing `template` is probed on disk, making the option a host file-existence oracle. |
| H-3 | HIGH, `init` data loss | `findConfig` walks up to the filesystem root, so `init` can adopt and overwrite an unrelated ancestor's config. |
| H-4 | HIGH, `init` data loss | `init` overwrites an existing `schema.json` with no check and no warning — a filename that collides easily. |
| M-1 | MEDIUM | `REF-004` substitutes a directory name into a `RegExp` unescaped: an unhandled crash on a name carrying regex metacharacters. |
| M-2 | MEDIUM | `columnUnique` ignores `exclude` whenever `files` is unset, producing false findings at `error` severity. |
| M-3 | MEDIUM | `{"rule":"custom"}` with no `id` crashes the config loader with a bare `TypeError`. |
| M-4 | MEDIUM | The `exclude` `init` writes is root-anchored, so it prunes only the noise at the repository root and leaves a monorepo's nested `dist`/`node_modules` in the corpus. |
| M-5 | MEDIUM | `init` writes are non-atomic: a failure partway leaves a half-written, undeclared state. |
| M-6 | MEDIUM | Operational failures exit `1` instead of `2` and print absolute host paths. |
| M-7 | MEDIUM | An unknown subcommand or a nonexistent path exits `0` with `"No problems found."`. |
| L-1 | LOW | `CTX-003` loses adjacent alias occurrences: its pattern consumes the boundary characters, so two occurrences one character apart cannot both match, while the guide promises every occurrence. |
| L-2 | LOW | The glossary makes `custom`'s `target` required; the code, the generated schema, and the guide all treat it as optional. |
| L-3 | LOW | `LLM-001` emits byte-identical duplicate findings — one per entrypoint — because each traversal reports `missing`/`cycles` independently and nothing deduplicates. |
| L-4 | LOW | The shared `exclude` option has **zero** end-to-end coverage across eight rule-family test files; the one unit test exercises it only together with `files`. The root cause of M-2. |
| L-5 | LOW | Quadratic hot paths: `classifyNodes` is called per document and `graph.edges` filtered twice inside it, and `findLineNumber` rescans from offset zero on every match. |
| L-6 | LOW | `--fix` writes non-atomically and LF-only, so a crash mid-write corrupts a user's Markdown and a CRLF tree ends up with mixed endings. |
| L-7 | LOW | `init` proposes hidden and **gitignored** trees as doc clusters; `.gitignore` is read nowhere, and the config it writes leaves `respectGitignore` at `false`, so they get linted. |
| L-8 | LOW | `merge` silently destroys every JSONC comment — acknowledged in a source comment, reported to nobody, while the configuration guide advertises comments as a feature. |
| L-9 | LOW | Deselecting every cluster interactively inverts into "lint the whole repository": the empty `include` is omitted from the file and the `**/*.md` default applies. The fake prompter always returned every cluster, so the case was untested. |
| L-10 | LOW | The written `$schema` is a dangling path in the ordinary `npx` case; six tests assert the string and none that its target exists. |
| L-11 | LOW | A cluster of small ones: `schema --out <relative>` resolves against `process.cwd()` rather than the io-seam `cwd`; `pnpm-workspace.yaml` is truncated at the first blank line; `detectPackageManager` looks only at the root; a helper with no production caller; two CI-workflow refusal paths return `undefined` silently; no top-level rejection handler in `bin`. |

### Section 4 in English — the systemic cause

The `p9-09` report treated each finding as a one-off instead of as a class to sweep, and stopped at the first instance of each:

- it found one inert option (`SC-1`) and stopped — the worse one was in `table.ts` (**M-2**);
- it found one duplicate-findings problem (`SC-2`) and stopped — the exact duplicates were in `llm.ts` (**L-3**);
- it found one regex problem (`TP-1`) and stopped — the crash from unescaped substitution was in `ref.ts` (**M-1**), and the lost adjacent matches in `ctx.ts` (**L-1**).

Plus a class of its own: **nothing tested the process boundary.** `src/index.ts` had no coverage at all (H-1), `exclude` had not one end-to-end test (L-4, the root of M-2), no `init` test exercised a write-failure scenario (M-5), and no test spawned the binary. That paragraph is what the four guard categories in [`.agents/rules/testing.md`](../../.agents/rules/testing.md) are the standing answer to.

> `SC-1`, `SC-2`, `TP-1` — and `BL-1`, `OG-1`, `SC-3` where P11/P12 cite them — are defined in the `p9-09` deep-audit report, which was removed from the tree in `d96b64c` and is recoverable from git history. They are not findings of this report; it references them only to show what its predecessor stopped short of.
