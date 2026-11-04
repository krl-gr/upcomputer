import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    // One-line summary: the meta description and the blog index blurb.
    description: z.string(),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    author: z.string().default("Kirill Gurianov"),
    // Drafts render in `astro dev` only; production builds and the sitemap skip them.
    draft: z.boolean().default(false),
    // Dev-only label for a draft that is ready to publish.
    releaseCandidate: z.boolean().default(false),
    // `run-in`: each h2 sits at the start of its first paragraph, like "Heading. Text...".
    headings: z.enum(["block", "run-in"]).default("block"),
  }),
});

export const collections = { blog };
