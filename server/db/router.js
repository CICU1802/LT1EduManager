import express from "express";
export function createDataRouter(service) {
  const router = express.Router();
  const route = (fn) => async (req, res, next) => {
    try {
      res.json(await fn(req));
    } catch (error) {
      next(error);
    }
  };
  const office = (req, res, next) => {
    if (!["admin", "vanphong"].includes(req.user.role))
      return res
        .status(403)
        .json({ error: "Bạn không có quyền sửa hồ sơ hoặc học phí." });
    next();
  };
  router.get(
    "/students",
    route(() => service.students()),
  );
  router.post(
    "/students",
    office,
    route((req) => service.createStudent(req.body, req.user.username)),
  );
  router.get(
    "/classes",
    route(() => service.classes()),
  );
  router.post(
    "/classes",
    office,
    route((req) => service.createClass(req.body, req.user.username)),
  );
  router.get(
    "/tuition",
    office,
    route(() => service.invoices()),
  );
  router.post(
    "/tuition",
    office,
    route((req) => service.saveInvoice(req.body, req.user.username)),
  );
  router.post("/tuition/:id/retry", office, (req, res) =>
    res.status(422).json({
      error:
        "Hóa đơn PostgreSQL được lưu bằng giao dịch; không cần đồng bộ Sheets.",
    }),
  );
  router.get(
    "/attendance/class/:classId",
    route((req) =>
      service.attendanceList(
        req.params.classId,
        req.query.date,
        req.query.sessionKey,
      ),
    ),
  );
  router.post(
    "/attendance",
    route((req) => service.saveAttendance(req.body, req.user.username)),
  );
  router.get(
    "/pending-students",
    route(() => service.pending()),
  );
  router.post(
    "/pending-students",
    route((req) => service.createPending(req.body, req.user.username)),
  );
  router.post(
    "/pending-students/:id/resolve",
    office,
    route((req) => service.resolvePending(req.params.id, req.user.username)),
  );
  router.get(
    "/attendance/sessions",
    route((req) => service.sessions(req.query.classId, req.query.date)),
  );
  router.post(
    "/attendance/sessions",
    office,
    route((req) => service.createSession(req.body, req.user.username)),
  );
  router.get(
    "/attendance/history",
    route((req) =>
      service.attendanceHistory(
        req.query.classId,
        req.query.date,
        req.query.sessionKey,
      ),
    ),
  );
  router.get(
    "/attendance/report",
    office,
    route((req) => service.attendanceReport(req.query.classId)),
  );
  router.get(
    "/parent-tasks",
    office,
    route(() => service.tasks()),
  );
  router.post(
    "/parent-tasks/:id/resolve",
    office,
    route((req) =>
      service.resolveTask(req.params.id, req.body, req.user.username),
    ),
  );
  router.get(
    "/makeups",
    route(() => service.makeups()),
  );
  router.post(
    "/makeups",
    office,
    route((req) => service.createMakeup(req.body, req.user.username)),
  );
  router.post(
    "/enrollments",
    office,
    route((req) => service.setEnrollment(req.body, req.user.username)),
  );
  router.post(
    "/classes/:id/schedule",
    office,
    route((req) =>
      service.setSchedule(req.params.id, req.body, req.user.username),
    ),
  );
  router.post(
    "/pending-students/:id/enroll",
    office,
    route((req) =>
      service.enrollPending(req.params.id, req.body, req.user.username),
    ),
  );
  router.get(
    "/students/:id/details",
    route((req) => service.studentDetail(req.params.id)),
  );
  router.post(
    "/families",
    office,
    route((req) => service.setFamily(req.body, req.user.username)),
  );
  router.post(
    "/results",
    office,
    route((req) => service.saveResult(req.body, req.user.username)),
  );
  router.get(
    "/tuition-quote",
    office,
    route((req) => service.feeQuote(req.query.studentId, req.query.classId)),
  );
  router.get(
    "/balances",
    office,
    route(() => service.balances()),
  );
  router.get(
    "/audit",
    office,
    route(
      async () =>
        (
          await service.db.query(
            "SELECT id,actor,action,entity,created_at FROM audit_log ORDER BY id DESC LIMIT 100",
          )
        ).rows,
    ),
  );
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error.code === "23505")
      return res.status(409).json({ error: "Mã dữ liệu đã tồn tại." });
    const status = error.status || 500;
    res.status(status).json({
      error:
        status >= 500
          ? "Cơ sở dữ liệu chưa sẵn sàng. Vui lòng thử lại."
          : error.message,
    });
  });
  return router;
}
