// @ts-nocheck
import { Router } from "express";

import { listUsers } from "./handlers";

const router = Router();

router.get("/users", listUsers);

export { router as apiRouter };
