// @ts-nocheck
import express from "express";

import sessionRouter from "./routes/session";
import userRouter from "./routes/user";

const app = express();

app.use(express.json());
app.use("/api", userRouter);
app.use("/api", sessionRouter);

export default app;
