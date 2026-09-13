import { defineCollection, reference, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(""),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/notes" }),
  schema: z.object({
    title: z.string().describe("Shown as the note's heading"),
    kind: z.enum(["idea", "todo", "reference"]).default("idea").describe("What sort of note this is"),
    about: reference("blog").optional().describe("The post this note is about"),
    pinned: z.boolean().optional(),
    priority: z.number().int().min(1).max(5).optional().describe("1 is highest"),
    updated: z.coerce.date().optional(),
  }),
});

export const collections = { blog, notes };
