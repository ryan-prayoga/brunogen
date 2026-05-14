const { Router } = require("express");

const { listUsers } = require("./handlers");

const router = Router();

router.get("/users", listUsers);

module.exports = { router };
