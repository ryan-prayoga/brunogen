exports.listUsers = function listUsers(req, res) {
  return res.status(200).json({
    data: [
      {
        id: 1,
        name: "Jane Doe",
      },
    ],
  });
};

exports.listAdmins = function listAdmins(req, res) {
  return res.status(200).json({
    data: [
      {
        id: 1,
        name: "Admin Jane",
      },
    ],
  });
};

exports.getStatus = function getStatus(req, res) {
  return res.json({
    ok: true,
  });
};
