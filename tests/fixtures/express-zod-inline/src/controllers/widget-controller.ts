// @ts-nocheck
import type { Request, Response } from "express";
import { z } from "zod";

const createWidgetSchema = z.object({
  name: z.string().min(3).max(80),
  owner_email: z.string().email(),
  status: z.enum(["draft", "published"]),
  price: z.coerce.number().min(1).max(999),
  tags: z.array(z.string()).optional(),
  metadata: z
    .object({
      trace_id: z.string().uuid(),
      notes: z.string().nullable().optional(),
    })
    .optional(),
});

export function createWidget(req: Request, res: Response) {
  const input = createWidgetSchema.parse(req.body);

  return res.status(201).json({
    data: input,
  });
}

export function searchWidgets(req: Request, res: Response) {
  const query = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      q: z.string().optional(),
    })
    .safeParse(req.query);

  if (!query.success) {
    return res.status(422).json({
      message: "Invalid query",
    });
  }

  return res.json({
    data: [],
  });
}
