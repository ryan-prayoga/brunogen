// @ts-nocheck
import express from "express";

import { createWidget, searchWidgets } from "./controllers/widget-controller";

const app = express();

app.post("/api/widgets", createWidget);
app.get("/api/widgets/search", searchWidgets);

export default app;
