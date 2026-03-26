exports.login = (req, res) => {
  const { email, password } = req.body;

  return res.status(200).json({
    token: "secret-token",
    email,
    password,
  });
};
