import type { APIRoute } from "astro";
import { SITE_URL, blogPostPath, getPublishedBlogPosts } from "../lib/blog";

const STATIC_PATHS = ["/", "/download/", "/atlas/", "/privacy/"];

// Generated so each published blog post joins the sitemap on its own; drafts stay out.
// The blog index joins with the first published post, like the Blog link in the layout.
export const GET: APIRoute = async () => {
  const posts = await getPublishedBlogPosts();
  const paths = posts.length > 0 ? [...STATIC_PATHS, "/blog/"] : STATIC_PATHS;
  const entries = [
    ...paths.map((path) => `  <url><loc>${new URL(path, SITE_URL)}</loc></url>`),
    ...posts.map((post) => {
      const lastModified = (post.data.updated ?? post.data.date).toISOString().slice(0, 10);
      return `  <url><loc>${new URL(blogPostPath(post), SITE_URL)}</loc><lastmod>${lastModified}</lastmod></url>`;
    }),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join("\n")}
</urlset>
`;
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
