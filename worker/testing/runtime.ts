import { dirname } from "node:path";
import { fileURLToPath, type URL as NodeURL } from "node:url";
import { build } from "esbuild";
import type { V4ModuleDefinition } from "miniflare";

// Bundle the real dependency graph, including Hono and Zod, for workerd tests.
export const getRuntimeModule = async ({
  contents,
  entry,
}: {
  contents?: string;
  entry: NodeURL;
}): Promise<V4ModuleDefinition> => {
  const path = fileURLToPath(entry);

  const result = await build({
    ...(contents === undefined
      ? { entryPoints: [path] }
      : {
          stdin: {
            contents,
            loader: "ts",
            resolveDir: dirname(path),
            sourcefile: path,
          },
        }),
    bundle: true,
    conditions: ["workerd", "worker", "browser"],
    external: ["node:crypto"],
    format: "esm",
    logLevel: "silent",
    platform: "browser",
    target: "es2023",
    write: false,
  });

  return {
    contents: result.outputFiles[0].text,
    path: path.replace(/\.ts$/, ".js"),
    type: "ESModule",
  };
};
