const express = require("express");

const routes = require("./routes");
const { adminRouter } = require("./admin-routes");
const defaultRouter = require("./default-routes");

const app = express();

app.use("/api", routes.router);
app.use("/admin", adminRouter);
app.use("/default", defaultRouter);

module.exports = app;
