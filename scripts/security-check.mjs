import { readFileSync, existsSync } from "node:fs";

const checks = [
  {
    file: "wrangler.toml",
    regex: /account_id\s*=\s*"(?!CLOUDFLARE_ACCOUNT_ID")[^"]+"/,
    message: "wrangler.toml contains a real Cloudflare account_id"
  },
  {
    file: "wrangler.toml",
    regex: /CLERK_PUBLISHABLE_KEY\s*=\s*"pk_test_/,
    message: "wrangler.toml is using a Clerk test publishable key"
  },
  {
    file: "src/dispatch/handlers/moby.ts",
    regex: /owner_header_name|owner_key_present/,
    message: "Moby handler is leaking owner bypass metadata"
  },
  {
    file: "public/providers.js",
    regex: /sessionStorage\.|localStorage\./,
    message: "Provider dashboard is persisting credentials in browser storage"
  },
  {
    file: "src/index.ts",
    regex: /sessionStorage\.setItem\(STORAGE_KEY, ownerKey\)/,
    message: "Admin playground is persisting owner credentials in browser storage"
  }
];

const failures = [];

for (const check of checks) {
  if (!existsSync(check.file)) continue;
  const content = readFileSync(check.file, "utf8");
  if (check.regex.test(content)) {
    failures.push(`${check.file}: ${check.message}`);
  }
}

if (failures.length) {
  console.error("Security check failed:\n" + failures.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}

console.log("Security check passed.");
