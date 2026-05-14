// @ts-nocheck
import { Router } from "express";

import { listReports } from "./handlers";

const router = Router();

router.get("/reports", listReports);

export default router;
