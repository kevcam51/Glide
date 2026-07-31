// Scope/typo checking for the Cloud Functions source (S167).
//
// `node --check` only parses — it cannot see that an identifier is undefined
// inside a function body, and Cloud Functions code can't be smoke-tested
// locally without deploying. S167 shipped `recordUsage(db, ...)` into three
// handlers where `db` was never in scope; every AI turn then threw from a
// `finally`, which replaced the user's reply with an error. `no-undef` catches
// exactly that in under a second.
//
// Run: npm run lint   (from functions/)
export default [
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        require: "readonly", module: "writable", exports: "writable",
        console: "readonly", process: "readonly", Buffer: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        fetch: "readonly", URL: "readonly", URLSearchParams: "readonly",
        FormData: "readonly", Blob: "readonly", AbortController: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly",
        __dirname: "readonly", __filename: "readonly",
        crypto: "readonly", structuredClone: "readonly",
      },
    },
    rules: { "no-undef": "error" },
  },
];
