# Code style

- Use `const` arrow functions for standalone functions. Avoid the `function` keyword.
- Implement every service as a class. Use regular methods with explicit `public` or `private` visibility, rather than arrow properties. Crypto helpers belong to a class with static methods.
- Always declare service method return types.
- Name service methods after their result and relevant inputs, such as `getMetricsByDropletId`, `getSessionByToken`, and `getDashboardByTimeRange`.
- Extract service helpers into private methods. Do not define functions or callbacks inside service methods.
- When a function, method, or constructor needs multiple inputs, accept one options object. Preserve signatures required by framework and platform callbacks.
- Alphabetize object keys, destructured keys, and interface/type members.
- Use `async` only for genuine asynchronous work. Keep calculations, formatting, validation, and other in-memory operations synchronous. Return an existing promise directly when no additional asynchronous processing is needed.
- Run independent asynchronous operations together with `Promise.all`. Keep dependent operations sequential. Use `Promise.allSettled` when partial failures must be handled and every operation must finish.
- Always use curly braces for control flow, including single-statement branches and loops.
- Group short, logically related declarations, assignments, and class fields together. Separate logical steps, multiline statements, and larger class members with blank lines. When a boundary is unclear, prefer a blank line.
- Follow the existing Prettier conventions: single quotes, no semicolons, and trailing commas.
