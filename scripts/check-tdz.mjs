#!/usr/bin/env node
// Fail on a const/let READ BEFORE ITS OWN DECLARATION in the same scope (S236).
//
// This class has now cost two outages and days of misdiagnosis:
//
//   • S213 — `muMinutes` read `pickedEx` above its own const, so picking a day
//     in "Make up a big day" threw a TDZ ReferenceError and white-screened the
//     app.
//   • S229/S236 — TrainerDashboard computed `searchable` from `clients.length`
//     NINE LINES ABOVE `const [clients, setClients] = useState([])`. Every
//     render of the trainer home threw "Cannot access 'clients' before
//     initialization". Kevin's screen went blank the moment he signed in and
//     stayed that way for two days while three fixes went into the service
//     worker, which was never the cause.
//
// ⚠️ `npm run check:undef` IS STRUCTURALLY BLIND TO THIS, and that blindness is
// why it went unnoticed twice: eslint's no-undef asks whether a binding EXISTS.
// It does exist — it is merely declared later — so no-undef stays quiet while
// the line throws at runtime. `node --check` sees valid syntax. A unit test only
// catches it if that exact component renders in the suite.
//
// ⚠️ AND IT ONLY REPORTS THE READS THAT ACTUALLY THROW. A reference from inside
// a NESTED function is legal and extremely common — a callback, an effect or an
// event handler declared above the const it closes over runs later, by which
// time the binding is initialised. Flagging those would bury the real ones in
// hundreds of false positives, and a checker nobody can keep green is a checker
// nobody runs (the reasoning in check-undef.mjs, which is why it lints ONE rule).
// So a read counts only when it is evaluated in the SAME function scope as the
// declaration, which is exactly the case that cannot survive to runtime.
//
// Run: node scripts/check-tdz.mjs
import { Linter } from "eslint";
import { readFileSync } from "fs";
import { execSync } from "child_process";

const files = execSync(
  'ls src/*.js src/*.jsx functions/*.js 2>/dev/null || true',
  { encoding: "utf8" },
).split("\n").filter(Boolean);

const linter = new Linter();
const found = [];
// How many files the rule actually executed on. See the note at the verify call.
let linted = 0;

// The nearest enclosing function (or module) scope — the unit that evaluates as
// one pass. Two references sharing it run in source order; across a function
// boundary they do not.
function evalScope(scope) {
  let s = scope;
  while (s && s.type !== "function" && s.type !== "module" && s.type !== "global") s = s.upper;
  return s;
}

const rule = {
  create(context) {
    return {
      "Program:exit"(node) {
        linted++;
        const sm = context.sourceCode.scopeManager;
        const walk = (scope) => {
          for (const v of scope.variables) {
            const def = v.defs[0];
            if (!def || def.type !== "Variable") continue;
            const kind = def.parent && def.parent.kind;
            if (kind !== "const" && kind !== "let") continue;
            const declAt = def.name.range[0];
            const home = evalScope(v.scope);
            for (const ref of v.references) {
              const at = ref.identifier.range[0];
              if (at >= declAt) continue;                     // declared first: fine
              if (evalScope(ref.from) !== home) continue;      // deferred: legal
              found.push({
                file: context.filename,
                line: ref.identifier.loc.start.line,
                name: v.name,
                declLine: def.name.loc.start.line,
              });
            }
          }
          scope.childScopes.forEach(walk);
        };
        walk(sm.acquire(node) || sm.globalScope);
      },
    };
  },
};

for (const file of files) {
  const code = readFileSync(file, "utf8");
  // ⚠️ `files` MUST NAME .jsx EXPLICITLY. Flat config defaults to
  // **/*.{js,mjs,cjs}, so src/App.jsx — the 41,000-line file this whole check
  // exists for — matched NOTHING and the rule never ran. It reported "no TDZ
  // reads" on a file containing the exact bug, twice, while I read the output
  // as good news. A bare "**/*" does not work either; the extensions have to be
  // spelled out. `linted` below is what stops that being silent a third time.
  const msgs = linter.verify(code, {
    files: ["**/*.js", "**/*.jsx", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { tdz: { rules: { check: rule } } },
    rules: { "tdz/check": "error" },
  }, file);
  const fatal = msgs.filter((m) => m.fatal);
  if (fatal.length) {
    console.error(`  parse error in ${file}: ${fatal[0].message} (line ${fatal[0].line})`);
    process.exit(2);
  }
}

// ⚠️ A CHECK THAT DID NOT RUN IS NOT A CHECK THAT PASSED. This script silently
// linted zero files at first and printed a tick. Never again: if the rule did
// not execute once per file, that is a failure, not a clean bill of health.
if (linted !== files.length) {
  console.error(`\n✗ the rule ran on ${linted} of ${files.length} files — config is not matching. Not reporting a pass.\n`);
  process.exit(2);
}
if (!found.length) {
  console.log(`✓ no const/let read before its own declaration (${files.length} files)`);
  process.exit(0);
}
console.log(`\n${found.length} temporal-dead-zone read(s) — these THROW when the line runs:\n`);
for (const f of found) {
  console.log(`  ${f.file}:${f.line}  reads '${f.name}', declared at line ${f.declLine}`);
}
console.log(`\nMove the declaration above its first read.\n`);
process.exit(1);
