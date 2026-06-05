// @ts-nocheck
import { Router } from "express";

import { listReports } from "./handlers";

const defaultRouter = Router();
defaultRouter.get("/reports", listReports);

export const namedRouter = Router();
namedRouter.post("/reports", listReports);

export default defaultRouter;
