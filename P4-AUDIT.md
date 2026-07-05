# Аудит фазы P4 — ContextGraph / graph / slice / impact

> Дата: 2026-07-05 · Ревьюер: Claude (Opus 4.8) · Ветка: `feat/p4-graph-chain`
> Область: **только фаза P4** (задачи P4.01–P4.08). Другие фазы не рассматривались.
> Код **не изменялся** — это аудит «как есть».

---

## 1. Итоговый вердикт

**Качество высокое.** Фаза P4 реализована близко к требованиям, с сильной детерминированностью,
аккуратным разделением core / CLI и очень плотными комментариями «why, not what». Все формальные
критерии приёмки (`Exit criteria`) в файлах задач отмечены и **действительно** выполнены в коде.

Проверочные гейты (запущены в рамках аудита):

| Гейт | Результат |
| --- | --- |
| `npm run typecheck` | ✅ чисто |
| `npm test` | ✅ **242 теста, 30 файлов — все зелёные** (в т.ч. 8 графовых сьютов + e2e) |
| `npm run build` | ✅ чисто |
| `npm run lint` | ✅ `No issues found` |

**Блокирующих дефектов не найдено.** Найдены: 1 реальное ограничение корректности среднего уровня
(id-ref рёбра из блоков кода), несколько мелких недочётов и пара мест, где формулировка в
документации задачи **переобещает** относительно фактической реализации.

Сводка находок:

| Severity | Кол-во | Находки |
| --- | --- | --- |
| 🟠 Medium | 1 | A |
| 🟡 Low–Medium | 1 | B |
| 🔵 Low | 5 | C, D, E, H, I |
| ⚪ Informational | 2 | F, G |

---

## 2. Методология

1. Прочитаны требования именно P4: [docs/mdlint_v2/P4-graph/index.md](docs/mdlint_v2/P4-graph/index.md),
   все 8 файлов задач `01`–`08`, и локированный источник
   [requirements/03-context-graph.md](docs/mdlint_v2/requirements/03-context-graph.md) (решения G1–G9),
   плюс ссылка на R5 (унификация GRP-правил).
2. Прочитана вся реализация P4 в `@wastech-mdlint/core` (10 модулей `graph/*` + смежные
   `engine/defined-ids.ts`, `engine/path-resolve.ts`) и хост-адаптер `@wastech-mdlint/cli`
   (`commands.ts`, `program.ts`).
3. Прочитаны все 7 core-тестов графа + 2 e2e/CLI-сьюта.
4. Ключевые предположения **проверены эмпирически** прогонами против собранного `dist/`
   (см. ссылки «подтверждено» в находках).

---

## 3. Соответствие требованиям (матрица G1–G9 + R5)

| # | Требование | Статус | Комментарий |
| --- | --- | --- | --- |
| **G1** | Семантические рёбра `link/anchor/image/import/id-ref`, по одному на конструкцию | ✅ | Таксономия соблюдена; `#fragment` → `anchor`, иначе `link`; self-ref пропущены. См. [build-context-graph.ts](packages/core/src/graph/build-context-graph.ts). Оговорка по id-ref — находка **A**. |
| **G2** | Единый query-слой для slice/impact/MCP/compile | ⚠️ частично | `slice`/`impact` реально идут через `query()`. Но topo-sort/components/SCC строят **свою** смежность (см. находки **G/I**) — «одна точка обхода» верна только для slice/impact. |
| **G3** | Метаданные ребра (`text`, `rawTarget`) | ✅ (с нюансом) | `text`+`rawTarget` у link/anchor; `rawTarget` у image/import/id-ref. У image нет `text`(=alt) — находка **E**. |
| **G4** | Честный детерминированный индекс для slice + честный `--help` | ✅ | Точное сопоставление (Map/Set), без fuzzy; `SLICE_RESOLUTION_DESCRIPTION` шарится между `--help` и (будущим) MCP. Покрыто тестом на `--help`. |
| **G5** | Сигнал покрытия при неполном `include` | ⚠️ узко | `computeGraphCoverage` корректен, но выводится **только** в `graph --format human`. В JSON/lint/mermaid/dot его нет — находка **B**. |
| **G6** | Явные циклы (Tarjan SCC), не молчаливая усечённая topo | ✅ | Циклы считаются один раз в билдере, хранятся в `graph.cycles`; `excluded` в topo честно раскрывает выброшенное. Отлично покрыто тестами. |
| **G7** | Схлопывание дублей рёбер с `count` | ✅ (backlog) | Корректно **не** делалось (backlog); мультипликативность рёбер сохранена намеренно и задокументирована. |
| **G8** | Инкрементальная/кэшируемая пересборка | ✅ (backlog) | Вне P4, ок. |
| **G9** | Экспорт `graph --format mermaid\|dot` | ✅ | Реализовано, id по индексу (без коллизий путей), экранирование меток, детерминизм — покрыто. |
| **R5** | GRP-правила потребляют один общий граф, без своих обходов | ✅ (с нюансом) | GRP-001 читает `graph.cycles`, GRP-002 читает `graph.inDegree`; своей смежности у правил нет. Формулировка «no parallel adjacency anywhere» всё же переобещает — находка **G**. |

Вывод по матрице: **всё принятое (G1, G3, G4, G6, G9, R5) реализовано**; G2 и G5 реализованы, но
уже́ по охвату, чем можно было ожидать из текста требования.

---

## 4. Оценка по задачам P4.01–P4.08

### P4.01 — `ContextGraph` + `buildContextGraph` (семантические рёбра) ✅
Все AC выполнены. Типы `ContextGraphNode/Edge/Graph` заморожены (`path`/`from`/`to`), таксономия рёбер
соблюдена, anchor-рёбра валидируются по slug заголовка цели (не деградируют до `link`), self-ref
пропускаются, сортировка детерминирована. Node identity перекладывается на `document.path` —
корректно для любого способа ключевания входной Map.
**Недочёты, отнесённые к этой задаче:** **A** (id-ref по сырому контенту), **D** (мёртвые опции
`exclude`/`entryPoints`), **E** (image без `text`), **H** (пунктуация ломает id-ref).

### P4.02 — Алгоритмы: topo-sort, components, явные циклы ✅
Kahn с отсортированной очередью (бинарная вставка `lowerBound`), недедуп-in-degree корректно
схлопывается перед Kahn (иначе параллельные рёбра «застрянут» — есть регресс-тест), компоненты
сортируются по размеру, затем по мин. пути. Циклы переиспользуются из `graph.cycles`.
**Недочёты:** **F** (формулировка «reuse the existing Tarjan» — фактически написана новая
реализация), **G/I** (отдельная смежность `buildDedupedViews`).

### P4.03 — Единый query-слой ✅
`query(graph,{start,direction,depth?,edgeTypes?})` cycle-safe по построению (`visited` раз на узел),
`depth` опционален, различие `edgeTypes: undefined` (все) vs `[]` (ничего) реализовано и покрыто
тестом, `via` детерминирован (наименьший предшественник на минимальной глубине).
**Недочёты:** **I** (topo/components/SCC не ходят через этот слой — но это оправдано, это не
traversal-запросы).

### P4.04 — Детерминированный индекс + `slice` ✅
Индекс по `byId`/`bySlug`/`paths`; фиксированный приоритет `#`→anchor, иначе path→id→heading;
только точное сравнение; slug берётся из канонических github-slugger-слагов парсера (дедуп `-1/-2`).
Мульти-старт объединяется с «побеждает минимальная глубина». Честная семантика вынесена в
экспортируемую строку. AC полностью закрыты.

### P4.05 — Impact (`getImpactSet`/`classifyImpact`) ✅
Обратный BFS без лимита глубины (полное замыкание), `directlyAffected` c `references`,
`transitivelyAffected` c `via`, reading order по подграфу затронутых, `ImpactAnalysisError` с
подсказкой для файла вне корпуса (без недетерминированного «did you mean»). Есть регресс на
топологический (не лексический) порядок. `relativizeImpact` реализован **но не используется CLI**
(ждёт P7) — это по плану, не дефект.

### P4.06 — GRP на общий граф + сигнал покрытия ✅
`settings.idRef` заведён end-to-end (config-schema → load-config → `ResolvedSettings` →
`buildContextGraph` в `lint-files.ts` и `load-context.ts`). GRP-код не тронут (подтверждено).
`resolveTargetCandidates` вынесен в общий `path-resolve.ts`. `computeGraphCoverage` корректен.
**Недочёты:** **B** (узкое поверхностное отображение G5), **D** (в `lint-files.ts:84-90`
задокументировано, что `exclude`/`entryPoints` так и **не** заведены — вопреки прогнозу P4.01),
**G** (переобещание «no parallel adjacency anywhere»).

### P4.07 — CLI `graph`/`slice`/`impact` + mermaid/dot ✅
Тонкие хендлеры (`loadConfiguration`→`loadContext`→один вызов core→рендер). `impact` линтит весь
корпус и фильтрует host-side (чтобы не «голодать» project-правила) — верное решение, граф
инжектится в `lintFiles({graph})` без пересборки. Коды выхода: `slice`-«нет совпадения» и чистый
`impact` → 0; файл вне корпуса → 2.
**Недочёты:** **C** (JSON `impact` не содержит `excluded`), **B** (coverage только в human).

### P4.08 — Тесты и фикстуры ✅
Одна общая фикстура `packages/cli/test/fixtures/graph-project/`, e2e по всем 4 форматам `graph`,
`slice`, `impact`, подтверждение GRP-001/002 через реальный путь `config-load → lintFiles`,
двойная проверка детерминизма (byte-identical + пресортированность). Осознанно: `design.md`
достижим только id-ref-ребром (для проверки impact), и он же становится вторым «сиротой» — это
задокументировано и тест утверждает конкретную находку, а не эксклюзивное множество.
**Замечание по покрытию:** отсутствуют тесты на находки **A** (id-ref в блоках кода) и **H**
(пунктуация) — см. раздел 6.

---

## 5. Находки (детально)

### 🟠 A. id-ref рёбра строятся по **сырому** markdown, включая блоки кода / инлайн-HTML / frontmatter
**Задача:** P4.01 · **Файл:** [build-context-graph.ts:42](packages/core/src/graph/build-context-graph.ts#L42),
[build-context-graph.ts:70-88](packages/core/src/graph/build-context-graph.ts#L70-L88)

`buildIdRefEdges` сканирует `document.content` — это **полный сырой текст файла**
([document-types.ts:104](packages/core/src/markdown/document-types.ts#L104), устанавливается из
`params.content` в [parse-document.ts:341](packages/core/src/markdown/parse-document.ts#L341)) —
регуляркой `PROSE_TOKEN_PATTERN = /[^\s,]+/g`. Никакой фильтрации по типу узла AST нет, поэтому ID,
упомянутый **только внутри ограждённого блока кода** (пример, лог, сниппет), создаёт полноценное
`id-ref` ребро.

**Подтверждено эмпирически:** документ, где `REQ-1` встречается лишь в ` ``` `-блоке, всё равно
даёт ребро `{from:"design.md", to:"reqs.md", type:"id-ref", line:4}`.

**Последствия:**
- `impact <definer>` покажет файл-с-примером как *directly affected* (ложное «на тебя влияет»).
- `slice` притянет лишний файл.
- `inDegree` файла-определителя раздувается → влияет на `GRP-002` (файл ошибочно считается
  «на который ссылаются»).

**Оценка:** реальное, но приемлемое для v2 ограничение «честного простого» подхода. Таксономия
G1 говорит про «plain-text token», а блок кода — не совсем prose. Стоит хотя бы задокументировать
как известное ограничение (в духе §8 роадмапа «Honesty in docs») и покрыть тестом ожидаемое
поведение. Тестов на это нет.

---

### 🟡 B. Сигнал покрытия (G5) виден только в `graph --format human`
**Задача:** P4.06 (ядро) / P4.07 (поверхность) · **Файл:**
[commands.ts:141-155](packages/cli/src/commands.ts#L141-L155)

`computeGraphCoverage` вызывается **только** в ветке текстового формата `handleGraph`. Ветки
`json`/`mermaid`/`dot` его не считают, `lint` не показывает вовсе. JSON `graph` по AC —
`{nodes,edges,components,readingOrder}` — покрытия не содержит
([graph-render.ts:32-39](packages/core/src/graph/graph-render.ts#L32-L39)).

**Последствия:** любой машинный потребитель (CI, будущий MCP, агент), который читает
`graph --format json`, **не получает** `filesOutsideCorpus` вообще. Практическая ценность G5
(«не дать молча получить неполный impact/orphan») теряется именно там, где она нужнее всего.

**Нюанс:** формально реализация **следует AC** (AC для JSON явно не включает coverage, а P4.06
объявляет модуль «core-only»). То есть это скорее пробел в самом плане/AC, чем отклонение
реализации. Но по духу G5 — узко.

---

### 🔵 C. JSON-вывод `impact` не содержит `excluded from reading order`
**Задача:** P4.07 · **Файл:** [commands.ts:223-231](packages/cli/src/commands.ts#L223-L231)

`classifyImpact` возвращает `excluded` (узлы, выброшенные из reading order из-за циклов), и
human-рендер их показывает ([graph-render.ts:167-169](packages/core/src/graph/graph-render.ts#L167-L169)),
а JSON-полезная нагрузка — нет. Расхождение human vs json. Соответствует AC (там перечислены только
`changedFile/directlyAffected/transitivelyAffected/readingOrder/lint`), но означает, что при
циклах в затронутом подграфе JSON-потребитель видит «неполный readingOrder» без объяснения, что
именно и почему выпало.

---

### 🔵 D. Опции `exclude` и `entryPoints` в `BuildContextGraphOptions` объявлены, но **нигде не читаются** по итогам всей P4
**Задача:** P4.01 (введены) / P4.06 (обещано «заведём») · **Файл:**
[context-graph-types.ts:16-21](packages/core/src/graph/context-graph-types.ts#L16-L21),
[build-context-graph.ts:108](packages/core/src/graph/build-context-graph.ts#L108) (читается только
`siteRouter`; `idRef` — на L169)

P4.01 (implementation notes) писала, что использование этих опций — «P4.06 scope». Но P4.06 явно
отказался их заводить ([lint-files.ts:84-90](packages/core/src/engine/lint-files.ts#L84-L90):
«exclude/entryPoints remain unwired»). Итог: два поля остаются **мёртвым API** после всей фазы.
`entryPoints` для GRP-002 приходит из **опций правила**, а не отсюда.

**Подтверждено эмпирически:** `buildContextGraph(docs, {exclude:["a.md"]})` не исключает `a.md`
из узлов.

**Оценка:** мягко противоречит правилу проекта в
[coding-style.md](.agents/rules/coding-style.md) — «Do not build extension points for hypothetical
future needs». Форвард-совместимость задокументирована, но прогноз P4.01 оказался неверным, и это
следовало бы отразить (или убрать опции).

---

### 🔵 E. Image-рёбра не несут `text` (alt-текст), хотя G3 просит метку ребра
**Задача:** P4.01 · **Файл:** [build-context-graph.ts:150](packages/core/src/graph/build-context-graph.ts#L150)

Для `link`/`anchor` заполняется `text` (метка ссылки). Для `image` естественная метка — alt-текст —
не переносится (`text` опущен). G3 говорит про «`text` (link/anchor label)», так что формально
image не обязателен, но объяснимость (для CLI/MCP/`--fix`) у image-рёбер беднее, чем могла бы быть.
Мелочь.

---

### 🔵 H. Определение id-ref ломается о примыкающую пунктуацию (`REQ-1.`, `REQ-1)`)
**Задача:** P4.01 · **Файл:** [build-context-graph.ts:42](packages/core/src/graph/build-context-graph.ts#L42),
[build-context-graph.ts:71-73](packages/core/src/graph/build-context-graph.ts#L71-L73)

Токенизатор режет только по `\s` и `,`. Поэтому `«Blocks REQ-1.»` даёт токен `"REQ-1."`, который не
проходит `idPattern ^REQ-\d+$`, и ребро **не создаётся**.

**Подтверждено эмпирически:** `«Blocks REQ-1.»` → 0 id-ref рёбер; `«Blocks REQ-1 today.»` → 1 ребро.

**Оценка:** это осознанно консистентно с колоночным токенайзером
([defined-ids.ts:12-14](packages/core/src/engine/defined-ids.ts#L12-L14)), но в прозе точка в конце
предложения — очень частый кейс, и такой промах тихий. Реальное ограничение полноты impact/slice;
стоит хотя бы задокументировать. Тестов на граничную пунктуацию нет.

---

### 🔵 I. «Единый query-слой» (G2) не покрывает topo-sort / components / SCC
**Задача:** P4.02/P4.03 · **Файлы:**
[query.ts:39-73](packages/core/src/graph/query.ts#L39-L73) (`buildAdjacency`),
[graph-algorithms.ts:25-60](packages/core/src/graph/graph-algorithms.ts#L25-L60) (`buildDedupedViews`),
[build-context-graph.ts:203-264](packages/core/src/graph/build-context-graph.ts#L203-L264) (`detectCycles`)

Через `query()` ходят только `slice`/`impact`. `topologicalSort`/`getComponents` строят собственную
недедуп-смежность, `detectCycles` — третью (для Tarjan). Это **оправданно** (topo/SCC/компоненты —
не «start→traversal»-запросы, `query` их не выразит) и задокументировано в P4.03. Но означает, что
«одна точка обхода» из G2 — только про slice/impact, не про весь граф. Информационно.

---

### ⚪ F. «Reuse the existing Tarjan implementation» — фактически написана новая реализация
**Задача:** P4.02 · **Файл:** [build-context-graph.ts:199-295](packages/core/src/graph/build-context-graph.ts#L199-L295)

Требование G6 и задача P4.02 говорят «переиспользовать существующую реализацию Tarjan». В текущем
дереве **нет** отдельной прежней реализации Tarjan (легаси-`src/` уже удалён при P0-миграции) —
`detectCycles` написан заново в билдере. Реализация корректна и покрыта тестами; замечание только к
формулировке «reuse», которая не соответствует факту.

---

### ⚪ G. Формулировка exit-criteria P4.06 «no parallel adjacency anywhere» переобещает
**Задача:** P4.06 · **Файл:** [P4-graph/06-grp-refactor-coverage.md:79-81](docs/mdlint_v2/P4-graph/06-grp-refactor-coverage.md#L79-L81)

Буквально в core есть **три** внутренних построителя смежности (`detectCycles`, `buildDedupedViews`,
`buildAdjacency`) — см. находку **I**. Замысел критерия («у GRP-правил и у хостов нет своей
параллельной смежности — они читают один граф») **выполнен**. Но дословная формулировка
«no parallel adjacency anywhere» неточна. Информационно, к документации.

---

## 6. Оценка тестового покрытия

**Сильно.** 8 графовых core-сьютов + 2 CLI/e2e, все строят граф из **настоящего** markdown
(`parseDocument` → `buildContextGraph`), а не из хендмейд-литералов графа — это ловит реальные
изменения формы рёбер.

Хорошо покрыто: типизация link/anchor, валидация anchor по slug, self-ref, image (corpus vs
on-disk), import, мультипликативность, id-ref (колонка + заголовок + отсутствие конфига + self-def),
siteRouter, node identity; Kahn (в т.ч. дедуп-регресс), компоненты и тай-брейки, циклы; query
forward/reverse/depth/edgeTypes/`[]`vs`undefined`/diamond-`via`/cycle-safety/детерминизм; slice
резолвинг всех категорий + приоритеты + мульти-старт; impact direct/transitive/cycle/
reference-multiplicity/out-of-corpus/`relativizeImpact` (в т.ч. топо ≠ лексика); coverage
(non-md/missing/corpus/root-escape/router/дедуп); все рендеры + экранирование; e2e всех 4 форматов
`graph`, `slice` (json/human/no-match/`--help`/плохой `--depth`), `impact`
(json/human/out-of-corpus→2); подтверждение GRP-001/002; двойная проверка детерминизма.

**Пробелы в тестах (соотнесены с находками):**
- **A** — нет теста, фиксирующего поведение id-ref внутри блоков кода / frontmatter / inline-HTML.
- **H** — нет теста на примыкающую пунктуацию у id-ref токена.
- **E** — нет проверки, что image-ребро (не) несёт `text`.
- Нет теста на `slice --depth 0` (граничное значение `parseDepth` допускает 0).

---

## 7. Сильные стороны (что сделано хорошо)

1. **Детерминизм на всех уровнях** — все выводимые массивы сортируются перед выдачей; двойная
   e2e-проверка byte-identical. Полностью в духе §8 роадмапа и правил проекта.
2. **Честная архитектура core-hosts-the-pipeline** — CLI-хендлеры реально тонкие (~10 строк),
   вся логика в core; `loadContext` инжектит один граф и в `lintFiles`, и в query/slice/impact
   (нет двойной сборки графа).
3. **Отличная документация кода** — плотные «why»-комментарии с обоснованиями компромиссов
   (мультипликативность vs дедуп для Kahn, `via`-YAGNI, `cwd`-relative и т.д.). Файлы задач честно
   фиксируют, где реальная дельта оказалась у́же формулировки AC.
4. **Cross-platform корректность** — repo-relative POSIX везде, `localeCompare`, `normalizeRelativePath`,
   guard на `escapesRoot`, аккуратная работа со slug/фрагментами (decode симметричен парсеру).
5. **`settings.idRef` заведён end-to-end** без «залезания» в приватные опции REF-005 — чисто и
   discoverable.
6. **Честная семантика slice** (G4) вынесена в один экспортируемый текст, который переиспользует и
   `--help`, и (будущий) MCP — нет расхождения формулировок.

---

## 8. Рекомендации (без изменений кода — на будущее)

1. **A/H (приоритет):** ограничить id-ref-скан прозой (исключить `code`/`inlineCode`/frontmatter,
   например пройдясь по AST, а не по сырому `content`) **или** явно задокументировать оба ограничения
   как «известные» и добавить фиксирующие тесты. Сейчас impact/slice могут молча раздуваться или
   недобирать.
2. **B:** решить продуктово, должен ли сигнал покрытия (G5) попадать в `graph --format json` и/или в
   `lint`-диагностику — иначе для агентов/CI он практически недоступен. Если оставляем human-only —
   зафиксировать это как сознательное сужение G5.
3. **C:** рассмотреть добавление `excluded` в JSON-полезную нагрузку `impact` для паритета с human.
4. **D:** либо завести `exclude`/`entryPoints` в `buildContextGraph`, либо убрать их из
   `BuildContextGraphOptions` — сейчас это мёртвый форвард-API вопреки правилам стиля.
5. **F/G:** поправить формулировки в файлах задач P4.02/P4.06 («reuse existing Tarjan» →
   «implement Tarjan in the builder»; «no parallel adjacency anywhere» → «no parallel adjacency in
   rules/hosts»), чтобы документация не переобещала.
6. **E:** при желании — переносить alt как `text` у image-рёбер (дешёвая доработка объяснимости G3).

---

### Приложение — карта «задача → файл реализации»

| Задача | Основные файлы |
| --- | --- |
| P4.01 | [graph/context-graph-types.ts](packages/core/src/graph/context-graph-types.ts), [graph/build-context-graph.ts](packages/core/src/graph/build-context-graph.ts), [engine/defined-ids.ts](packages/core/src/engine/defined-ids.ts) |
| P4.02 | [graph/graph-algorithms.ts](packages/core/src/graph/graph-algorithms.ts), `detectCycles` в [graph/build-context-graph.ts](packages/core/src/graph/build-context-graph.ts) |
| P4.03 | [graph/query.ts](packages/core/src/graph/query.ts) |
| P4.04 | [graph/search-index.ts](packages/core/src/graph/search-index.ts) |
| P4.05 | [graph/impact-analysis.ts](packages/core/src/graph/impact-analysis.ts) |
| P4.06 | [graph/coverage.ts](packages/core/src/graph/coverage.ts), [engine/path-resolve.ts](packages/core/src/engine/path-resolve.ts), [engine/lint-files.ts](packages/core/src/engine/lint-files.ts), [config/config-schema.ts](packages/core/src/config/config-schema.ts) |
| P4.07 | [cli/src/commands.ts](packages/cli/src/commands.ts), [cli/src/program.ts](packages/cli/src/program.ts), [graph/graph-render.ts](packages/core/src/graph/graph-render.ts), [graph/load-context.ts](packages/core/src/graph/load-context.ts) |
| P4.08 | [cli/test/graph.e2e.test.ts](packages/cli/test/graph.e2e.test.ts), [cli/test/fixtures/graph-project/](packages/cli/test/fixtures/graph-project/), 7× `packages/core/test/graph-*.test.ts` + `search-index-slice.test.ts` |
