// @ts-nocheck
import { Router } from "express";
import { listUsers, runUserAction } from "./handlers";

const USERS_BASE = "/users";
const ACTION_SUFFIX = "/actions";

export const usersRouter = Router();

usersRouter.get(USERS_BASE, listUsers);
usersRouter.post(`${USERS_BASE}/:id${ACTION_SUFFIX}`, runUserAction);
