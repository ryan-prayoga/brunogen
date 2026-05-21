// @ts-nocheck
import express from "express";
import { usersRouter } from "./routes";

const API_PREFIX = "/api";
const API_VERSION = "v1";
const API_MOUNT = API_PREFIX + "/" + API_VERSION;

const app = express();

app.use(API_MOUNT, usersRouter);

export default app;
