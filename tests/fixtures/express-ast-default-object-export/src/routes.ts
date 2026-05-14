// @ts-nocheck
import express from "express";

import { listUsers } from "./handlers";

const router = express.Router();

router.get("/users", listUsers);

export default { router };
