const { Router } = require("express");
const { login } = require("../controllers/session-controller");

const router = Router();

router.post("/sessions", login);

module.exports = router;
