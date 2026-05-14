// @ts-nocheck
import express from "express";

import reportsRouter from "./reports";

const app = express();

app.use("/api", reportsRouter);

export default app;
