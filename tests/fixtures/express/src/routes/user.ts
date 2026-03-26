// @ts-nocheck
import { Router } from "express";

import { createUser, showUser } from "../controllers/user-controller";
import authMiddleware from "../middleware/auth";

const router = Router();

router.use(authMiddleware);
router.route("/users")
  .post(createUser);
router.get("/users/:id", showUser);

export default router;
