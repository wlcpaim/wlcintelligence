import { findMissingDependencies, type BootstrapFile } from "./bootstrap";

const KNOWN: Record<string, string> = {
  "@tailwindcss/vite": "^4.0.0", "@tailwindcss/postcss": "^4.0.0",
  "@vitejs/plugin-react": "^4.3.0", "lucide-react": "^0.460.0",
  "clsx": "^2.1.1", "tailwind-merge": "^3.0.0",
  "@supabase/supabase-js": "^2.48.0", "react-router-dom": "^6.28.0",
  "postcss": "^8.4.0", "autoprefixer": "^10.4.0",
};

/** Only fill known missing imports; never guess arbitrary packages or overwrite declared versions. */
export function reconcileMissingDependencies(files: BootstrapFile[]): BootstrapFile[] {
  const file = files.find(f => f.path === "package.json");
  if (!file) return [];
  try {
    const pkg = JSON.parse(file.content) as Record<string, unknown>;
    if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) return [];
    const deps = { ...(pkg["dependencies"] as Record<string, string> | undefined) };
    const dev = { ...(pkg["devDependencies"] as Record<string, string> | undefined) };
    const tailwind = deps["tailwindcss"] ?? dev["tailwindcss"];
    let changed = false;
    for (const missing of findMissingDependencies(files)) {
      let version = KNOWN[missing.pkg];
      if (!version) continue;
      if (missing.pkg === "@vitejs/plugin-react") {
        const viteMajor = (deps["vite"] ?? dev["vite"] ?? "").match(/\d+/)?.[0];
        if (viteMajor === "7") version = "^5.0.0";
        else if (viteMajor && !["4", "5", "6"].includes(viteMajor)) continue;
      }
      if (missing.pkg === "tailwind-merge" && tailwind?.match(/\d+/)?.[0] === "3") version = "^2.6.0";
      if (missing.pkg.startsWith("@tailwindcss/")) {
        // An explicit v3 declaration must be resolved by QA, not silently upgraded.
        if (tailwind && tailwind.match(/\d+/)?.[0] !== "4") continue;
        if (!tailwind) { dev["tailwindcss"] = "^4.0.0"; }
        version = "^4.0.0";
      }
      const target = /^(?:vite|postcss|tailwind)\.config\./.test(missing.path) || missing.pkg.startsWith("@tailwindcss/") ? dev : deps;
      target[missing.pkg] = version;
      changed = true;
    }
    if (!changed) return [];
    pkg["dependencies"] = deps;
    pkg["devDependencies"] = dev;
    return [{ path: file.path, content: JSON.stringify(pkg, null, 2) + "\n" }];
  } catch { return []; }
}