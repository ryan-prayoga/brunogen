// @ts-nocheck
import type { Request, Response } from "express";

export function listReports(req: Request, res: Response) {
  return res.json({
    data: [],
  });
}
