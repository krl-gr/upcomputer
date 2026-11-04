import { getCollection, type CollectionEntry } from "astro:content";

export type BlogPost = CollectionEntry<"blog">;

export const SITE_URL = "https://up.computer";

export function blogPostPath(post: BlogPost): string {
  return `/blog/${post.id}/`;
}

/** Posts visible in this build, newest first. Drafts show only in `astro dev`. */
export async function getBlogPosts(): Promise<BlogPost[]> {
  const posts = await getCollection("blog", (post) => import.meta.env.DEV || !post.data.draft);
  return posts.sort(
    (a, b) =>
      b.data.date.getTime() - a.data.date.getTime() || a.data.title.localeCompare(b.data.title),
  );
}

/** Published posts only, for the sitemap. */
export async function getPublishedBlogPosts(): Promise<BlogPost[]> {
  return (await getBlogPosts()).filter((post) => !post.data.draft);
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function formatPostDate(date: Date): string {
  return DATE_FORMAT.format(date);
}
