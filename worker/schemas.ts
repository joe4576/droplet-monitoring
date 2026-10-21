import { z } from "zod";

export const authKeySchema = z
  .string()
  .refine((value) => value.trim().length > 0)
  .refine((value) => value !== "replace-with-a-long-random-login-key");

export const sessionTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const dropletIdsSchema = z
  .string()
  .transform((value) => value.split(",").map((id) => id.trim()))
  .pipe(
    z.tuple([z.string().regex(/^[1-9]\d*$/), z.string().regex(/^[1-9]\d*$/)]),
  )
  .refine(([first, second]) => first !== second);

export const digitalOceanConfigSchema = z.object({
  ids: dropletIdsSchema,
  token: z
    .string()
    .trim()
    .min(1)
    .refine((value) => value !== "replace-with-your-personal-access-token"),
});

const metricLabelSchema = z.string();

export const seriesSchema = z.object({
  metric: z.record(z.string(), z.unknown()).transform((labels) =>
    Object.fromEntries(
      Object.entries(labels).flatMap(([key, value]) => {
        const parsed = metricLabelSchema.safeParse(value);

        return parsed.success ? [[key, parsed.data]] : [];
      }),
    ),
  ),
  values: z.array(z.tuple([z.number(), z.union([z.string(), z.number()])])),
});

export const metricsResponseSchema = z.object({
  data: z.object({ result: z.array(seriesSchema) }),
  status: z.literal("success"),
});

export const dropletResponseSchema = z.object({
  droplet: z.object({
    disk: z.number().nullable().catch(null),
    memory: z.number().nullable().catch(null),
    name: z.string().nullable().catch(null),
    region: z
      .object({ slug: z.string().nullable().catch(null) })
      .catch({ slug: null }),
    status: z.string().nullable().catch(null),
    vcpus: z.number().nullable().catch(null),
  }),
});

export type Series = z.infer<typeof seriesSchema>;

export type DropletMetadata = z.infer<typeof dropletResponseSchema>["droplet"];
