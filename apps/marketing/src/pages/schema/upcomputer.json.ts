import type { APIRoute } from "astro";
import { buildT3ProjectFileJsonSchema } from "@t3tools/shared/t3ProjectFile";

// Project files written by Up.computer 0.0.32 and earlier reference this URL.
// The current project file schema is a superset of theirs.
export const prerender = true;
export const GET: APIRoute = () =>
  Response.json({
    ...buildT3ProjectFileJsonSchema(),
    $id: "https://up.computer/schema/upcomputer.json",
  });
