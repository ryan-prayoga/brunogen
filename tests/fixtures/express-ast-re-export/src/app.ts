// @ts-nocheck
import express from "express";

import { reportsRouter, router } from "./routes";

const app = express();

app.use("/api", reportsRouter);
app.use("/star", router);

export default app;
