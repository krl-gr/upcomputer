import type { APIRoute } from "astro";
import { buildProjectConfigFileJsonSchema } from "@upcomputer/shared/projectConfigFile";

export const prerender = true;
export const GET: APIRoute = () => Response.json(buildProjectConfigFileJsonSchema());
